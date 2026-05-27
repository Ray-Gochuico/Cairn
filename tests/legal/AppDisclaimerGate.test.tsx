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
    setHousehold({ disclaimerVersionAccepted: '1.5' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders the modal (and hides children) when the accepted version is stale (v1.1)', () => {
    // A user on v1.1 (which shipped with the literal [PLACEHOLDER] string
    // in the governing-law sentence) must be re-prompted on the v1.5 bump.
    setHousehold({ disclaimerVersionAccepted: '1.1' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).toBeNull();
  });

  it('surfaces a "what changed" hint when the stale version is re-prompted', () => {
    setHousehold({ disclaimerVersionAccepted: '1.4' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    const changes = screen.getByText(/what changed since you last accepted/i);
    expect(changes).toBeInTheDocument();
    // For v1.5 the disclosures.ts ships an explicit diffFromPrevious that
    // summarizes the drawdown gross-up + frozen-brackets additions; that
    // takes precedence over the fallback.
    expect(
      screen.getByText(/Version 1\.5 adds two new bullets/i),
    ).toBeInTheDocument();
  });

  it('calls acceptDisclaimer when the user accepts the new version', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    setHousehold({ disclaimerVersionAccepted: '1.4' });
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', '1.5');
    });
  });
});
