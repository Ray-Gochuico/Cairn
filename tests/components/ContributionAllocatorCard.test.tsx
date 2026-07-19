import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ContributionAllocatorCard } from '@/pages/calculators/ContributionAllocatorCard';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useContributionsStore } from '@/stores/contributions-store';
import {
  AccountType,
  AssetClass,
  CompoundingFrequency,
  FiPillsPosition,
  RefreshCadence,
  SnapshotSource,
} from '@/types/enums';
import type { AppSettings, AssetClassTarget } from '@/types/schema';

// The stores' real load() hits getDatabase(); we seed state directly and stub
// load() to a no-op, so no DB is needed.
vi.mock('@/db/db', () => ({
  getDatabase: () => ({ select: async () => [] }),
}));

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

function seedStores(targets: AssetClassTarget[] | null) {
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
    holdings: [
      { id: 1, accountId: 1, ticker: 'VTI', shareCount: 7, targetAllocationPct: null, costBasis: null },
      { id: 2, accountId: 1, ticker: 'BND', shareCount: 3, targetAllocationPct: null, costBasis: null },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useSnapshotsStore.setState({
    snapshots: [
      { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 1000, source: SnapshotSource.MANUAL },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useTickersStore.setState({
    tickers: [
      {
        ticker: 'VTI', name: 'Vanguard Total', assetClass: AssetClass.US_TOTAL_MARKET,
        leverageFactor: 1, direction: 'LONG', userAdded: false, accentColor: null,
        sector: null, industry: null,
      },
      {
        ticker: 'BND', name: 'Vanguard Bonds', assetClass: AssetClass.US_BONDS,
        leverageFactor: 1, direction: 'LONG', userAdded: false, accentColor: null,
        sector: null, industry: null,
      },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useSettingsStore.setState({
    settings: { ...baseSettings, assetClassTargetAllocations: targets },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  });
  // Wave 18 D4: the contribution prefill derives from rolling-12-month
  // history (12 × $500 within the pinned year → $500/mo). Tests that need
  // an empty history override this after seeding.
  useContributionsStore.setState({
    contributions: [
      '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01',
      '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
      '2026-04-01', '2026-05-01',
    ].map((date, i) => ({
      id: i + 1, accountId: 1, personId: null, date, amount: 500, source: 'MANUAL',
    })) as never,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

describe('ContributionAllocatorCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    seedStores(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty state is a real Link to Investments (UX H1)', async () => {
    seedStores(null);
    render(
      <MemoryRouter>
        <ContributionAllocatorCard cardId="contribution-allocator" />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: /set asset-class targets/i });
    expect(link).toHaveAttribute('href', '/investments');
  });

  it('allocates a contribution in DOLLARS — results table + cash left, NO Shares column (H1)', async () => {
    // VTI 700 / BND 300; target 50/50. A $1000 buy moves toward 50/50.
    seedStores([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ContributionAllocatorCard cardId="contribution-allocator" />
      </MemoryRouter>,
    );
    const input = await screen.findByRole('spinbutton', { name: /contribution/i });
    await user.clear(input);
    await user.type(input, '1000');
    expect(await screen.findByTestId('allocator-results')).toBeInTheDocument();
    expect(screen.getByTestId('allocator-cash-left')).toBeInTheDocument();
    // Dollars only: there is no "Shares" column header.
    expect(screen.queryByRole('columnheader', { name: /^shares$/i })).toBeNull();
    // Before/after tracking-error stat pair (Finance M3, ½·Σ|drift|). Before is
    // ½(|0.7−0.5|+|0.3−0.5|) = 20.0%; buying toward 50/50 must not increase it.
    expect(screen.getByTestId('allocator-drift-before')).toHaveTextContent('20.0%');
    const after = Number(
      screen.getByTestId('allocator-drift-after').textContent!.replace(/[^\d.]/g, ''),
    );
    expect(after).toBeLessThanOrEqual(20.0);
  });

  it('names the overweight class(es) in the unreachable callout (UX M3)', async () => {
    // VTI 700 is already above its 30% target ⇒ US Total Market overweight.
    seedStores([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.3 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.7 },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ContributionAllocatorCard cardId="contribution-allocator" />
      </MemoryRouter>,
    );
    const input = await screen.findByRole('spinbutton', { name: /contribution/i });
    await user.clear(input);
    await user.type(input, '100');
    // Both the reason AND the class name appear in the callout (not a generic
    // footnote). Scope to the note so the results-table class cell doesn't match.
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/without selling/i);
    expect(note).toHaveTextContent(/US Total Market/i);
  });

  it('explains a targeted class with nothing held instead of a silent empty table (wave-9)', async () => {
    // Target 50% Intl Developed, but the household holds nothing there — its
    // budget can't be deployed and stays in cash. A large enough contribution
    // keeps US Total Market from going overweight, so only the unheld-target
    // note renders.
    seedStores([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.INTL_DEVELOPED, targetPct: 0.5 },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ContributionAllocatorCard cardId="contribution-allocator" />
      </MemoryRouter>,
    );
    const input = await screen.findByRole('spinbutton', { name: /contribution/i });
    await user.clear(input);
    await user.type(input, '1000');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/hold\s+nothing/i);
    expect(note).toHaveTextContent(/Intl Developed/i);
    expect(note).toHaveTextContent(/stays in cash/i);
  });

  it('discloses the snapshot-distribution approximation, held-positions-only (Finance L2)', async () => {
    seedStores([{ assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 }]);
    render(
      <MemoryRouter>
        <ContributionAllocatorCard cardId="contribution-allocator" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/latest snapshot per account/i)).toBeInTheDocument();
    expect(screen.getByText(/held positions only/i)).toBeInTheDocument();
  });
});

describe('ContributionAllocatorCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 17)', async () => {
    seedStores([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ]);
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    // Wave 18: the meaning carries the allocated-of-contribution reading.
    expect(await screen.findByTestId('contribution-allocator-meaning')).toHaveTextContent(
      /of a .* contribution, allocated toward your targets/i,
    );
  });

  it('no-targets state: headline —, cairn glyph, targets CTA in the meaning slot', () => {
    seedStores(null);
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    expect(screen.getByTestId('contribution-allocator-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /set asset-class targets/i }),
    ).toHaveAttribute('href', '/investments');
  });
});


describe('ContributionAllocatorCard — calculator-state + grouped buys (Wave 18 C12)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    seedStores([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('D4: prefills the monthly contribution from rolling-12-month history (12 × $500 → 500)', async () => {
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    const input = (await screen.findByRole('spinbutton', { name: /monthly contribution/i })) as HTMLInputElement;
    expect(Number(input.value)).toBe(500);
    // Results render from the derived prefill — no fabricated $1,000 anywhere.
    expect(await screen.findByTestId('allocator-results')).toBeInTheDocument();
  });

  it('D4: no history → blank field + an honest prompt, no results section', async () => {
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null } as never);
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    const input = (await screen.findByRole('spinbutton', { name: /monthly contribution/i })) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(
      screen.getByText(/enter a monthly contribution to see the buy plan/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('allocator-results')).toBeNull();
    expect(screen.queryByText(/\$1,000/)).toBeNull();
  });

  it('Reset to my data restores the derived prefill', async () => {
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    const input = (await screen.findByRole('spinbutton', { name: /monthly contribution/i })) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '900' } });
    expect(Number(input.value)).toBe(900);
    fireEvent.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(
      Number((screen.getByRole('spinbutton', { name: /monthly contribution/i }) as HTMLInputElement).value),
    ).toBe(500);
  });

  it('grouped buy list: class header rows + Subtotal rows summing to Total allocated', async () => {
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    const table = await screen.findByTestId('allocator-results');
    // Class group headers replace the per-row Class column.
    expect(within(table).getByText('US Total Market')).toBeInTheDocument();
    expect(within(table).getByText('US Bonds')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^class$/i })).toBeNull();
    // Subtotal rows: their dollars sum to the Total allocated tile.
    const subtotals = within(table).getAllByText('Subtotal');
    expect(subtotals.length).toBeGreaterThan(0);
    const sum = subtotals
      .map((el) => el.closest('tr')!)
      .reduce((a, tr) => a + Number((tr.textContent ?? '').replace(/[^\d.]/g, '')), 0);
    const total = Number(
      screen.getByTestId('allocator-total').textContent!.replace(/[^\d.]/g, ''),
    );
    expect(sum).toBeCloseTo(total, 0);
  });

  it('D5: an explicit next-dollar beats the historical statistic; Reset returns to it', async () => {
    const { useNextDollarStore } = await import('@/lib/calculators/next-dollar-store');
    const { act } = await import('@testing-library/react');
    act(() => useNextDollarStore.getState().setAmount(300));
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    const input = (await screen.findByRole('spinbutton', { name: /monthly contribution/i })) as HTMLInputElement;
    // Store $300 wins over the $500 typical statistic — the user just told
    // us the number (D5).
    expect(Number(input.value)).toBe(300);
    // Local override wins over a later store change; Reset returns to shared.
    fireEvent.change(input, { target: { value: '900' } });
    act(() => useNextDollarStore.getState().setAmount(350));
    expect(
      Number((screen.getByRole('spinbutton', { name: /monthly contribution/i }) as HTMLInputElement).value),
    ).toBe(900);
    fireEvent.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(
      Number((screen.getByRole('spinbutton', { name: /monthly contribution/i }) as HTMLInputElement).value),
    ).toBe(350);
    act(() => useNextDollarStore.getState().setAmount(null));
  });

  it('drift tiles carry the plain-language caption', async () => {
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    expect(
      await screen.findByText(/Share of your portfolio that would need to move to hit targets\./),
    ).toBeInTheDocument();
  });

  it('persistent Adjust targets link renders with targets set', async () => {
    render(<MemoryRouter><ContributionAllocatorCard cardId="contribution-allocator" /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /adjust targets/i })).toHaveAttribute(
      'href',
      '/investments',
    );
  });
});
