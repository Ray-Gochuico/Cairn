import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConcentrationCard } from '@/components/cards/ConcentrationCard';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import {
  AccountType,
  AssetClass,
  SnapshotSource,
  TickerDirection,
} from '@/types/enums';

/**
 * The card pulls from five stores via useConcentration(). We seed each
 * store directly via setState() so the hook composes a real report without
 * touching the DB. Pattern mirrors Dashboard.test.tsx.
 */
function resetStores() {
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} });
  useTickersStore.setState({
    tickers: [],
    isLoading: false,
    error: null,
    load: async () => {},
    upsert: async () => {},
    remove: async () => {},
    lookup: () => undefined,
  });
  useFundHoldingsStore.setState({
    fundHoldings: [],
    isLoading: false,
    error: null,
    load: async () => {},
    getForFund: () => [],
  });
}

describe('ConcentrationCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders "0 warnings" and the no-issues message when stores are empty', () => {
    render(
      <MemoryRouter>
        <ConcentrationCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/0 warnings/i)).toBeInTheDocument();
    expect(screen.getByText(/no concentration issues detected/i)).toBeInTheDocument();
    // "See full breakdown" link is hidden when there are no warnings.
    expect(screen.queryByRole('link', { name: /see full breakdown/i })).not.toBeInTheDocument();
  });

  it('renders the warning count and warning messages when warnings fire', () => {
    // AAPL at 30% triggers PER_TICKER_HIGH (>25%). BND at 70% triggers
    // PER_TICKER_HIGH (US_BONDS is a fund-class so falls through to its own
    // ticker exposure when no fundHoldings rows seed look-through). US_BONDS
    // at 70% also triggers PER_ASSET_CLASS_HIGH (>60%). Three warnings; the
    // card shows the first three and the count.
    useAccountsStore.setState({
      accounts: [{
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
      }],
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'AAPL', shareCount: 30, targetAllocationPct: null, costBasis: null },
        { id: 2, accountId: 1, ticker: 'BND', shareCount: 70, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useSnapshotsStore.setState({
      snapshots: [{
        id: 1, accountId: 1, snapshotDate: '2026-05-01', totalValue: 100_000,
        source: SnapshotSource.MANUAL,
      }],
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useTickersStore.setState({
      tickers: [
        { ticker: 'AAPL', name: null, assetClass: AssetClass.SINGLE_STOCK, leverageFactor: 1, direction: TickerDirection.LONG, userAdded: false, accentColor: null },
        { ticker: 'BND', name: null, assetClass: AssetClass.US_BONDS, leverageFactor: 1, direction: TickerDirection.LONG, userAdded: false, accentColor: null },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
      upsert: async () => {},
      remove: async () => {},
      lookup: () => undefined,
    });

    render(
      <MemoryRouter>
        <ConcentrationCard />
      </MemoryRouter>,
    );

    // The card shows the warning count in the headline. We use a match that
    // tolerates pluralisation but asserts a non-zero count.
    expect(screen.getByText(/\d+ warnings?/)).toBeInTheDocument();
    // AAPL message must surface in the top 3.
    expect(screen.getByText(/AAPL is 30\.0% of effective exposure/i)).toBeInTheDocument();
    // "See full breakdown" link points at Investments.
    const link = screen.getByRole('link', { name: /see full breakdown/i });
    expect(link).toHaveAttribute('href', '/investments');
  });

  it('uses red severity icon (text-red-500) for HIGH severity warnings', () => {
    useAccountsStore.setState({
      accounts: [{
        id: 1, householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
        name: 'Brokerage', institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null, autoFetchEnabled: false,
        excludedFromNetWorth: false, stateOfPlan: null,
        accentColor: null,
      }],
      isLoading: false, error: null, load: async () => {},
    });
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'AAPL', shareCount: 100, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false, error: null, load: async () => {},
    });
    useSnapshotsStore.setState({
      snapshots: [{
        id: 1, accountId: 1, snapshotDate: '2026-05-01', totalValue: 100_000,
        source: SnapshotSource.MANUAL,
      }],
      isLoading: false, error: null, load: async () => {},
    });
    useTickersStore.setState({
      tickers: [
        { ticker: 'AAPL', name: null, assetClass: AssetClass.SINGLE_STOCK, leverageFactor: 1, direction: TickerDirection.LONG, userAdded: false, accentColor: null },
      ],
      isLoading: false, error: null, load: async () => {},
      upsert: async () => {}, remove: async () => {}, lookup: () => undefined,
    });

    render(
      <MemoryRouter>
        <ConcentrationCard />
      </MemoryRouter>,
    );

    // At 100% AAPL, both PER_TICKER_HIGH (HIGH/red) and PER_ASSET_CLASS_HIGH
    // (HIGH/red) fire. There must be at least one red icon.
    const icons = screen.getAllByLabelText(/HIGH severity/i);
    expect(icons.length).toBeGreaterThan(0);
    expect(icons[0]).toHaveClass('text-red-500');
  });
});
