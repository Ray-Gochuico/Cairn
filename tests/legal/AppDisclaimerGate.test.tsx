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
    setHousehold({ disclaimerVersionAccepted: '1.0' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders the modal (and hides children) when the accepted version is stale', () => {
    setHousehold({ disclaimerVersionAccepted: '0.9' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).toBeNull();
  });

  it('surfaces a default "what changed" hint that references prior + current versions', () => {
    setHousehold({ disclaimerVersionAccepted: '0.9' });
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    const changes = screen.getByText(/what changed since you last accepted/i);
    expect(changes).toBeInTheDocument();
    // The fallback message references both the prior and current versions.
    expect(screen.getByText(/version 0\.9/i)).toBeInTheDocument();
    expect(screen.getByText(/current version is 1\.0/i)).toBeInTheDocument();
  });

  it('calls acceptDisclaimer when the user accepts the new version', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    setHousehold({ disclaimerVersionAccepted: '0.9' });
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(<AppDisclaimerGate>{CHILD}</AppDisclaimerGate>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', '1.0');
    });
  });
});
