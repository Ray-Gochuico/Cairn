import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Roadmap from '@/pages/Roadmap';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

// Roadmap document is still on v1.0; app_wide bumped to v1.1 in
// 2026-05-27 to add UCC § 2-316 / US-only / governing-law clauses.
const ACCEPTED_VERSION = '1.0';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    disclaimerAcceptedAt: '2026-05-01T00:00:00Z',
    disclaimerVersionAccepted: '1.1',
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

function resetStores(household: Household | null) {
  useHouseholdStore.setState({
    household,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as any);
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} } as any);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as any);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as any);
  useRoadmapOverridesStore.setState({
    overridesByNodeId: new Map(),
    isLoading: false,
    error: null,
    load: async () => {},
    setOverride: async () => {},
    clearOverride: async () => {},
  } as any);
}

describe('Roadmap page', () => {
  beforeEach(() => {
    resetStores(makeHousehold());
  });

  it('renders the roadmap disclosure modal when the gate is needs-acceptance', () => {
    // Household has not accepted the roadmap disclosure → gate fires.
    resetStores(makeHousehold({ roadmapDisclaimerVersionAccepted: null }));
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /about the roadmap/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open roadmap/i })).toBeDisabled();
  });

  it('renders the page content when the gate is ready', () => {
    resetStores(
      makeHousehold({ roadmapDisclaimerVersionAccepted: ACCEPTED_VERSION }),
    );
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    // Persistent banner is always visible.
    expect(
      screen.getByText(/educational tool — not financial advice/i),
    ).toBeInTheDocument();
    // Section headers are rendered for all 7 sections.
    expect(screen.getByText('Section 0')).toBeInTheDocument();
    expect(screen.getByText('Section 6')).toBeInTheDocument();
    expect(screen.getByText('Budget and Essentials')).toBeInTheDocument();
  });

  it('shows a setup prompt when the household has not loaded yet', () => {
    resetStores(null);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/set up your household to see your roadmap/i),
    ).toBeInTheDocument();
  });
});
