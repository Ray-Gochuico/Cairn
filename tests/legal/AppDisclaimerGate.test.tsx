import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppDisclaimerGate } from '@/legal/AppDisclaimerGate';
import { useHouseholdStore } from '@/stores/household-store';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

const baseHousehold: Household = {
  id: 1,
  name: null,
  filingStatus: FilingStatus.SINGLE,
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 5000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.03,
  growthScenarios: [],
  disclaimerAcceptedAt: null,
  disclaimerVersionAccepted: null,
  roadmapDisclaimerAcceptedAt: null,
  roadmapDisclaimerVersionAccepted: null,
};

function setHousehold(patch: Partial<Household>) {
  useHouseholdStore.setState({
    household: { ...baseHousehold, ...patch },
    isLoading: false,
    error: null,
  });
}

const CHILD = <div data-testid="app-child">App body</div>;

describe('AppDisclaimerGate', () => {
  beforeEach(() => {
    useHouseholdStore.setState({
      household: null,
      isLoading: false,
      error: null,
      // Replace load() with a no-op so the gate's useEffect mount doesn't
      // try to hit a real DB. The tests we care about either preseed the
      // household above OR leave it null deliberately.
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('renders children when household has not loaded yet (first-runner pre-wizard)', () => {
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders children when household has never accepted (first-runner mid-wizard)', () => {
    setHousehold({ disclaimerVersionAccepted: null });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders children when the accepted version matches the current version', () => {
    setHousehold({ disclaimerVersionAccepted: '1.1' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders the modal (and hides children) when the accepted version is stale', () => {
    // A user on the old v1.0 must be re-prompted on the v1.1 bump (which
    // added the UCC § 2-316 merchantability/fitness/non-infringement
    // disclaimer, US-only scope, and governing-law sentence).
    setHousehold({ disclaimerVersionAccepted: '1.0' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).toBeNull();
  });

  it('surfaces a "what changed" hint when the stale version is re-prompted', () => {
    setHousehold({ disclaimerVersionAccepted: '1.0' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    const changes = screen.getByText(/what changed since you last accepted/i);
    expect(changes).toBeInTheDocument();
    // For v1.1 the disclosures.ts ships an explicit diffFromPrevious that
    // names the new sections; that takes precedence over the fallback.
    // The diff banner is rendered inside its own <pre>, distinct from the
    // body — find that specific node.
    expect(screen.getByText(/Version 1\.1 adds three things/i)).toBeInTheDocument();
  });

  it('calls acceptDisclaimer when the user accepts the new version', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    setHousehold({ disclaimerVersionAccepted: '1.0' });
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', '1.1');
    });
  });
});
