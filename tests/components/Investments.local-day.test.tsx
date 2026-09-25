import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  AccountType,
  CompoundingFrequency,
  FiPillsPosition,
  FilingStatus,
  RefreshCadence,
  SnapshotSource,
} from '@/types/enums';
import type { AppSettings, CardLayoutEntry, GrowthScenario } from '@/types/schema';
import Investments from '@/pages/Investments';

/**
 * v1.7.0 R4 smoke (reader half): the Investments growth card ("Now") and the
 * Portfolio-by-account total are the latest snapshot on or before today, and
 * the page handed both helpers a LOCAL-midnight Date that they read through
 * UTC accessors — the PREVIOUS day east of UTC, so an Auckland balance
 * entered today reached neither. The page now hands them the local day's
 * UTC-noon bridge. The New York arms guard the west (where the old anchor
 * already agreed) against a UTC-day-of-the-instant anchor, which would count
 * a row dated the next local day. Harness: Investments.cards.test.tsx's
 * primed stores + stubbed getDatabase().
 */

const dbSelectImpl: { current: (sql: string, params?: unknown[]) => Promise<unknown[]> } = {
  current: async () => [],
};
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    select: (sql: string, params?: unknown[]) => dbSelectImpl.current(sql, params),
  }),
}));

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

const baseSettings: AppSettings = {
  id: 1,
  sidebarLayout: null,
  investmentsCardLayout: null,
  notificationsEnabled: false,
  notificationDay: 1,
  refreshCadence: RefreshCadence.MANUAL,
  lastRefreshAt: null,
  statementsFolderPath: null,
  defaultInflation: null,
  defaultReturnRate: null,
  defaultFiPillsPosition: FiPillsPosition.ABOVE,
  defaultProjectionDetailLevel: 'tax_bucket',
  defaultCashApy: null,
  defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
  defaultDrawdownTaxRate: null,
  propertyUtilitiesCategoryIds: null,
  vehicleGasCategoryIds: null,
  assetClassTargetAllocations: null,
};

function primeBaseStores(
  snapshotRows: Array<[string, number]>,
  initialLayout: CardLayoutEntry[] | null = null,
) {
  useAccountsStore.setState({
    accounts: [
      {
        id: 1,
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Brokerage',
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useHoldingsStore.setState({
    holdings: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useSnapshotsStore.setState({
    snapshots: snapshotRows.map(([snapshotDate, totalValue], i) => ({
      id: i + 1, accountId: 1, snapshotDate, totalValue, source: SnapshotSource.MANUAL,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useContributionsStore.setState({
    contributions: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: fourScenarios,
    },
    isLoading: false,
    error: null,
    load: async () => {},
  });
  usePersonsStore.setState({
    persons: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} });
  useFundHoldingsStore.setState({ fundHoldings: [], isLoading: false, error: null, load: async () => {} });
  useFundSectorsStore.setState({ fundSectors: [], isLoading: false, error: null, load: async () => {} });

  // settings-store.update() normally writes through SettingsRepo (SQLite). In
  // this test harness the DB is mocked to read-only, so we substitute an
  // in-memory update that patches the settings field directly — same observable
  // behaviour from the page's perspective (it re-renders when `settings`
  // changes).
  useSettingsStore.setState({
    settings: { ...baseSettings, investmentsCardLayout: initialLayout },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async (patch) => {
      const current = useSettingsStore.getState().settings ?? baseSettings;
      useSettingsStore.setState({ settings: { ...current, ...patch } });
    },
  });
}


async function readCards(): Promise<{ growthNow: HTMLElement; breakdownTotal: string }> {
  await screen.findByText(/Investments growth/i, {}, { timeout: 5000 });
  const growth = document.getElementById('growth')!;
  const byAccount = document.getElementById('by-account')!;
  const growthNow = await within(growth).findByTestId('growth-context');
  const breakdownTotal = byAccount.querySelector('.text-3xl')?.textContent ?? '';
  return { growthNow, breakdownTotal };
}

describe('Investments — the growth card and the by-account total read the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    dbSelectImpl.current = async () => [];
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // A year-old row gives every growth horizon a baseline, so "Now" renders.
  it('Pacific/Auckland, 09:00 NZST (21:00 UTC the previous day): the local 25th\'s balance', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    primeBaseStores([['2025-09-01', 90_000], ['2026-09-20', 100_000], ['2026-09-25', 120_000]]);
    render(<MemoryRouter><Investments /></MemoryRouter>);
    const { growthNow, breakdownTotal } = await readCards();
    await waitFor(() => expect(growthNow).toHaveTextContent('Now $120,000'));
    expect(breakdownTotal).toBe('$120,000');
  });

  it('New York, 23:33 EDT (03:33 UTC the next day): the local 24th\'s balance, not the next day\'s', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    primeBaseStores([
      ['2025-09-01', 90_000], ['2026-09-20', 100_000], ['2026-09-24', 120_000], ['2026-09-25', 150_000],
    ]);
    render(<MemoryRouter><Investments /></MemoryRouter>);
    const { growthNow, breakdownTotal } = await readCards();
    await waitFor(() => expect(growthNow).toHaveTextContent('Now $120,000'));
    expect(breakdownTotal).toBe('$120,000');
  });
});
