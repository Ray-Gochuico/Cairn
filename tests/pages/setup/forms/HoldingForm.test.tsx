import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// W19 fetch-on-add: onboarding holding creates request a market-data refresh.
vi.mock('@/market/fetch-on-add', () => ({ fetchMarketDataOnAdd: vi.fn() }));
// The wizard form calls getDatabase() only to hand it to fetch-on-add;
// no real DB is needed in these store-mocked tests.
vi.mock('@/db/db', () => ({ getDatabase: vi.fn(() => ({})) }));

import { fetchMarketDataOnAdd } from '@/market/fetch-on-add';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountType } from '@/types/enums';
import type { Account } from '@/types/schema';
import HoldingForm from '@/pages/setup/forms/HoldingForm';

function makeAccount(id: number, name: string): Account {
  return {
    id,
    householdId: 1,
    name,
    type: AccountType.ACCOUNT_BROKERAGE,
    institution: null,
    contributionLimitAnnual: null,
    employerMatchPct: null,
    apyRate: null,
    accountNumberLast4: null,
    notes: null,
    cryptoWalletAddress: null,
    isRetirementAccount: false,
    monthlyDistribution: null,
    distributionStartDate: null,
    cashApr: null,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    accentColor: null,
    sortOrder: null,
  };
}

describe('Wizard HoldingForm (adapter)', () => {
  beforeEach(() => {
    useHoldingsStore.setState({
      holdings: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    vi.mocked(fetchMarketDataOnAdd).mockClear();
  });

  it('renders an empty-state when no accounts exist', () => {
    useAccountsStore.setState({
      accounts: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    expect(
      screen.getByText(/add an account first/i),
    ).toBeInTheDocument();
  });

  it('renders an account picker and the underlying holding fields when accounts exist', () => {
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    expect(picker).toBeInTheDocument();
    expect(picker.value).toBe('1');
    expect(
      screen.getByRole('button', { name: /add holding/i }),
    ).toBeInTheDocument();
  });

  it('fires fetch-on-add once after a successful create (W19)', async () => {
    const create = vi.fn().mockResolvedValue(1);
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    useHoldingsStore.setState((s: any) => ({ ...s, create }));

    const user = userEvent.setup();
    render(<HoldingForm />);
    await user.type(screen.getByLabelText('ticker'), 'VTI');
    const shares = screen.getByLabelText('shares') as HTMLInputElement;
    await user.clear(shares);
    await user.type(shares, '5');
    await user.click(screen.getByRole('button', { name: /add holding/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(vi.mocked(fetchMarketDataOnAdd)).toHaveBeenCalledTimes(1),
    );
  });

  it('renders visible column titles above the holding row (W19: no unlabeled cells)', () => {
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    // VISIBLE titles (getByText, not aria queries) — the onboarding dialog
    // previously showed a bare placeholder-only row of four cells.
    expect(screen.getByText('Ticker')).toBeInTheDocument();
    expect(screen.getByText('Shares')).toBeInTheDocument();
    expect(screen.getByText('Target %')).toBeInTheDocument();
    expect(screen.getByText('Cost basis')).toBeInTheDocument();
    // The wizard has no margin UI — the margin hint must not leak in here.
    expect(screen.queryByText(/margin allowed/i)).toBeNull();
  });

  it('right-aligns numeric holding inputs with tabular numerals (Wave 11 T7)', () => {
    useAccountsStore.setState({
      accounts: [makeAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
    render(<HoldingForm />);
    expect(screen.getByLabelText('shares')).toHaveClass('tabular-nums');
    expect(screen.getByLabelText('cost basis')).toHaveClass('tabular-nums');
  });
});
