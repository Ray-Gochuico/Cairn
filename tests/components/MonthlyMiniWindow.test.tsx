import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { LoansRepo } from '@/domain/loans';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { AccountType, LoanType, SnapshotSource } from '@/types/enums';
import MonthlyMiniWindow from '@/pages/MonthlyMiniWindow';
import { formatDate } from '@/lib/format';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
    'utf-8',
  );
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');
const loadAppSettingsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0014_add_app_settings.sql'), 'utf-8');
const loadCashApyMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0024_cash_apy.sql'), 'utf-8');

// Capture the real store loads once — the W10 loading-gate test overrides
// accounts.load with a no-op, and resetStores must restore the real loads so
// later tests (which rely on the mount load fetching seeded DB rows) aren't
// left with a no-op load. Merged setState would otherwise keep the no-op.
const realAccountsLoad = useAccountsStore.getState().load;
const realSnapshotsLoad = useSnapshotsStore.getState().load;
const realLoansLoad = useLoansStore.getState().load;
const realPropertiesLoad = usePropertiesStore.getState().load;
const realVehiclesLoad = useVehiclesStore.getState().load;

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: realAccountsLoad });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: realSnapshotsLoad });
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: realLoansLoad });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: realPropertiesLoad });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: realVehiclesLoad });
}

describe('MonthlyMiniWindow', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
    ]);
    setDatabase(db);
    resetStores();
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the empty state with a back-to-dashboard button when there is nothing to confirm', async () => {
    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/nothing to confirm this month/i))
      .toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /back to dashboard/i }),
    ).toBeInTheDocument();
  });

  it('shows loading — not "Nothing to confirm this month." — while stores load (W10 M38)', () => {
    useAccountsStore.setState({ accounts: [], isLoading: true, error: null, load: async () => {} } as never);
    // (remaining stores resolved-empty per the file's reset helper)
    render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByText(/nothing to confirm this month/i)).not.toBeInTheDocument();
  });

  it('renders a derived-value card when an AUTO_DERIVED snapshot exists for last month', async () => {
    // Seed an account + an AUTO_DERIVED snapshot dated last month's close.
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    const snapshotsRepo = new AccountSnapshotsRepo(db);
    // Pick a date in the previous month — pick a Friday for safety. The page
    // queries by lastBusinessDayOfMonth(lastMonth), so seed exactly that.
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(
      Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0),
    );
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    const seedDate = lastBizDayUtc.toISOString().slice(0, 10);
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: seedDate,
      totalValue: 12345.67,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Brokerage One/)).toBeInTheDocument();
    });
    // Round-3 M3: the accessible name carries the entity.
    expect(screen.getByRole('button', { name: 'Confirm Brokerage One' })).toBeInTheDocument();
    expect(screen.getByText(/\$12,345\.67/)).toBeInTheDocument();
  });

  it('T25: the value-to-verify leads and a prior-month context line anchors it', async () => {
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0));
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    const seedDate = lastBizDayUtc.toISOString().slice(0, 10);
    const snapshotsRepo = new AccountSnapshotsRepo(db);
    // A PRIOR value (two months back) so the "was $X (±%)" anchor renders.
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: '2000-01-31',
      totalValue: 10000,
      source: SnapshotSource.USER_CONFIRMED,
    });
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: seedDate,
      totalValue: 12500,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);

    const value = await screen.findByTestId('derived-value');
    expect(value.textContent).toMatch(/\$12,500/);
    // Value node leads: it precedes the account-name node in document order.
    const name = screen.getByText(/Brokerage One · as of/);
    expect(value.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Prior context: 12,500 vs 10,000 = +25.0%.
    expect(screen.getByTestId('derived-prior').textContent).toBe('was $10,000.00 (+25.0%)');
  });

  it('renders a cash-balance card for CASH accounts', async () => {
    const accountsRepo = new AccountsRepo(db);
    await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Checking',
      institution: null,
      type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Checking')).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText(/balance for checking/i),
    ).toBeInTheDocument();
  });

  it('confirms a derived value as USER_CONFIRMED on click', async () => {
    const user = userEvent.setup();
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    const snapshotsRepo = new AccountSnapshotsRepo(db);
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(
      Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0),
    );
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    const seedDate = lastBizDayUtc.toISOString().slice(0, 10);
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: seedDate,
      totalValue: 5000,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm Brokerage One' }),
      ).toBeInTheDocument(),
    );
    // Wave-5 a11y fix: the status live region is pre-mounted EMPTY from the
    // start (not conditionally rendered with text already inside) — that's
    // what makes the polite announcement actually fire for SR users. Two
    // status regions exist once the "Confirm last month's values" section
    // is showing (the card's own span + the batch-summary paragraph), both
    // empty before any confirm — assert every one of them is empty.
    for (const el of screen.getAllByRole('status')) {
      expect(el).toHaveTextContent('');
    }
    await user.click(screen.getByRole('button', { name: 'Confirm Brokerage One' }));

    await waitFor(() => {
      const all = useSnapshotsStore.getState().snapshots;
      const updated = all.find(
        (s) => s.accountId === accountId && s.snapshotDate === seedDate,
      );
      expect(updated?.source).toBe(SnapshotSource.USER_CONFIRMED);
    });
    // Wave-4: the card's Confirmed flip is announced to screen readers.
    // The batch-summary status stays empty (no "Confirm all" click here),
    // so scope to the one that actually carries text.
    // T25: the confirmed state is a "✓ Confirmed" pill inside the role="status".
    const statusTexts = screen.getAllByRole('status').map((el) => el.textContent ?? '');
    expect(statusTexts.some((t) => t.includes('Confirmed'))).toBe(true);

    // W10 T6: confirming unmounted the Confirm button — focus must land on the
    // card's status region, not strand on <body>.
    await waitFor(() => {
      expect(document.body).not.toBe(document.activeElement);
      expect((document.activeElement as HTMLElement).getAttribute('role')).toBe('status');
    });
  });

  it('announces a failed confirm via role="alert" (Wave-4: inline card errors are announced)', async () => {
    const user = userEvent.setup();
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    const snapshotsRepo = new AccountSnapshotsRepo(db);
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(
      Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0),
    );
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: lastBizDayUtc.toISOString().slice(0, 10),
      totalValue: 5000,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm Brokerage One' });

    // Same store-stubbing idiom as the Confirm-all in-flight test.
    const orig = useSnapshotsStore.getState().upsert;
    useSnapshotsStore.setState({
      upsert: (async () => {
        throw new Error('Save failed');
      }) as typeof orig,
    } as never);
    try {
      await user.click(confirmBtn);
      expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i);
    } finally {
      useSnapshotsStore.setState({ upsert: orig } as never);
    }
  });

  it('renders a loan-payment card with the next amortization entry', async () => {
    const loansRepo = new LoansRepo(db);
    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    const firstPayment = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-01`;
    await loansRepo.create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Test Mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 100000,
      currentBalance: 100000,
      interestRate: 0.05,
      termMonths: 360,
      firstPaymentDate: firstPayment,
      monthlyPayment: 536.82,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Test Mortgage')).toBeInTheDocument();
    });
    const line = screen.getByText(/next scheduled payment/i);
    expect(line).toBeInTheDocument();
    // Wave-11 date-humanization miss: the payment date renders as
    // 'Aug 1, 2026', not the raw ISO 'YYYY-MM-01'.
    expect(line.textContent).toContain(formatDate(firstPayment));
    expect(screen.queryByText(firstPayment)).toBeNull();
  });

  it("renders a loan card as already recorded when this month's AMORTIZATION row exists (wave-9 M37)", async () => {
    // Seed: one loan whose next projected payment date already has an
    // AMORTIZATION loan_payments row (as if Confirm ran earlier this month).
    // A next-month firstPaymentDate makes the projected schedule[0] date
    // deterministic (nextPaymentDateFrom returns the future anchor itself).
    const loansRepo = new LoansRepo(db);
    const future = new Date();
    future.setDate(1);
    future.setMonth(future.getMonth() + 1);
    const firstPayment = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-01`;
    const loanId = await loansRepo.create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Seasoned mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 100000,
      currentBalance: 100000,
      interestRate: 0.05,
      termMonths: 360,
      firstPaymentDate: firstPayment,
      monthlyPayment: 536.82,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });
    await new LoanPaymentsRepo(db).create({
      loanId,
      paymentDate: firstPayment,
      principal: 120.15,
      interest: 416.67,
      extra: 0,
      source: 'AMORTIZATION',
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    const card = await screen.findByText('Seasoned mortgage');
    const scope = card.closest('[class*="rounded"]') as HTMLElement;
    const recorded = await within(scope).findByText(/already recorded/i);
    expect(recorded).toBeInTheDocument();
    // Wave-11 date-humanization miss: 'Already recorded for Aug 1, 2026',
    // not the raw ISO.
    expect(recorded.textContent).toContain(formatDate(firstPayment));
    expect(within(scope).queryByText(firstPayment)).toBeNull();
    expect(
      within(scope).queryByRole('button', { name: /^confirm (?!all)/i }),
    ).not.toBeInTheDocument();
  });

  it('MonthlyMiniWindow.tsx reads no app_settings (keeps the hand-rolled migration array valid)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/pages/MonthlyMiniWindow.tsx'),
      'utf-8',
    );
    // If this ever fails, the page started touching app_settings — either revert,
    // or add 0046 + the intervening app_settings migrations to the array at :48-54
    // (see plan D3). Fail here LOUDLY rather than as "no such column" mid-render.
    expect(src).not.toMatch(/last_seen_month/);
    expect(src).not.toMatch(/SettingsRepo/);
  });

  it('ritual buttons carry the entity in their accessible name (round-3 M3)', async () => {
    // One derived account 'Brokerage One', one loan 'Car loan' with a due
    // schedule entry, one cash account 'Checking'.
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0));
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    await new AccountSnapshotsRepo(db).upsert({
      accountId,
      snapshotDate: lastBizDayUtc.toISOString().slice(0, 10),
      totalValue: 5000,
      source: SnapshotSource.AUTO_DERIVED,
    });
    const future = new Date();
    future.setDate(1);
    future.setMonth(future.getMonth() + 1);
    const firstPayment = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-01`;
    await new LoansRepo(db).create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Car loan',
      type: LoanType.AUTO,
      originalAmount: 30000,
      currentBalance: 20000,
      interestRate: 0.05,
      termMonths: 60,
      firstPaymentDate: firstPayment,
      monthlyPayment: 566.14,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });
    await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Checking',
      institution: null,
      type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Confirm Brokerage One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Brokerage One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip Brokerage One' })).toBeInTheDocument();
    // The loan card needs a SECOND async resolution (projected schedule +
    // already-recorded lookup) beyond the account cards' load — await it, or
    // CI's scheduling asserts before it mounts (same class as the
    // Investments.cards.test.tsx flake fixed in 023acc5a).
    expect(await screen.findByRole('button', { name: 'Confirm Car loan payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip Car loan payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Checking balance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip Checking balance' })).toBeInTheDocument();
    // Visible labels are unchanged — terse for sighted users.
    expect(screen.getByRole('button', { name: 'Confirm Brokerage One' })).toHaveTextContent(/^Confirm$/);
  });

  it('a crypto account gets a manual-balance card in the ritual (round-3 E1)', async () => {
    // Crypto is a MANUAL_BALANCE_TYPES member (wallets are user-entered,
    // Yahoo stays observe-only) but Section 3 re-admitted only cash+savings.
    await new AccountsRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Cold wallet',
      institution: null,
      type: AccountType.ACCOUNT_CRYPTO,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);
    expect(await screen.findByText('Cold wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Cold wallet balance' })).toBeInTheDocument(); // Task 5 aria names
  });

  it('shows the "new month" eyebrow only when navigated with ?from=new-month', async () => {
    render(
      <MemoryRouter initialEntries={['/monthly?from=new-month']}>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/it.s a new month/i)).toBeInTheDocument();
  });

  it('does NOT show the eyebrow on a plain /monthly visit (banner-driven)', async () => {
    render(
      <MemoryRouter initialEntries={['/monthly']}>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/monthly check-in/i)).toBeInTheDocument();
    expect(screen.queryByText(/it.s a new month/i)).not.toBeInTheDocument();
  });

  describe('Confirm all', () => {
    /** Last month's close (the exact date the page queries by). */
    function lastMonthCloseISO(): string {
      const today = new Date();
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const d = new Date(Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0));
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
        d.setUTCDate(d.getUTCDate() - 1);
      }
      return d.toISOString().slice(0, 10);
    }

    async function seedDerivedAccount(
      name: string,
      totalValue: number,
      source: SnapshotSource,
    ): Promise<number> {
      const accountsRepo = new AccountsRepo(db);
      const accountId = await accountsRepo.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name,
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      });
      await new AccountSnapshotsRepo(db).upsert({
        accountId,
        snapshotDate: lastMonthCloseISO(),
        totalValue,
        source,
      });
      return accountId;
    }

    it('"Confirm all" excludes explicitly Skipped cards (W10 T11)', async () => {
      const user = userEvent.setup();
      const alphaId = await seedDerivedAccount('Alpha', 5000, SnapshotSource.AUTO_DERIVED);
      const betaId = await seedDerivedAccount('Beta', 7000, SnapshotSource.AUTO_DERIVED);
      render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);
      await screen.findByText(/Alpha/);
      // Skip the Alpha card.
      const alphaCard = screen.getByText(/Alpha/).closest('div[class*="rounded"]') as HTMLElement
        ?? screen.getByText(/Alpha/).closest('div')!;
      await user.click(within(alphaCard).getByRole('button', { name: 'Skip Alpha' }));
      // Confirm-all count drops to 1.
      expect(await screen.findByRole('button', { name: /confirm all \(1\)/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /confirm all/i }));
      const close = lastMonthCloseISO();
      await waitFor(() => {
        const snaps = useSnapshotsStore.getState().snapshots;
        const beta = snaps.find((s) => s.accountId === betaId && s.snapshotDate === close);
        const alpha = snaps.find((s) => s.accountId === alphaId && s.snapshotDate === close);
        expect(beta?.source).toBe(SnapshotSource.USER_CONFIRMED);
        // Alpha stays AUTO_DERIVED — it was Skipped, not ratified.
        expect(alpha?.source).toBe(SnapshotSource.AUTO_DERIVED);
      });
    });

    it('Confirm all ratifies every AUTO_DERIVED card and announces the result', async () => {
      const user = userEvent.setup();
      await seedDerivedAccount('Brokerage One', 5000, SnapshotSource.AUTO_DERIVED);
      await seedDerivedAccount('Brokerage Two', 7000, SnapshotSource.AUTO_DERIVED);
      await seedDerivedAccount('Already Done', 9000, SnapshotSource.USER_CONFIRMED);
      render(
        <MemoryRouter>
          <MonthlyMiniWindow />
        </MemoryRouter>,
      );
      const confirmAll = await screen.findByRole('button', { name: /confirm all/i });
      await user.click(confirmAll);
      const close = lastMonthCloseISO();
      await waitFor(() => {
        const snaps = useSnapshotsStore.getState().snapshots;
        const lastMonthSnaps = snaps.filter((s) => s.snapshotDate === close);
        expect(lastMonthSnaps.length).toBeGreaterThanOrEqual(3);
        expect(
          lastMonthSnaps.every(
            (s) =>
              s.source === SnapshotSource.USER_CONFIRMED ||
              s.source === SnapshotSource.MANUAL,
          ),
        ).toBe(true);
      });
      // Wave-4 adaptation: per-card "Confirmed" spans are role="status" too,
      // so query all live regions and find the batch summary among them.
      const statuses = screen.getAllByRole('status').map((el) => el.textContent ?? '');
      expect(statuses.some((t) => /confirmed 2 account values/i.test(t))).toBe(true);
      // Cards reflect the batch confirmation without a remount.
      expect(screen.getAllByText(/Confirmed/).length).toBeGreaterThanOrEqual(2);
    });

    it('Confirm all is disabled while the batch is in flight', async () => {
      const user = userEvent.setup();
      await seedDerivedAccount('Brokerage One', 5000, SnapshotSource.AUTO_DERIVED);
      render(
        <MemoryRouter>
          <MonthlyMiniWindow />
        </MemoryRouter>,
      );
      const confirmAll = await screen.findByRole('button', { name: /confirm all/i });
      const orig = useSnapshotsStore.getState().upsert;
      let release: () => void = () => {};
      const gate = new Promise<void>((res) => { release = res; });
      useSnapshotsStore.setState({
        upsert: (async (input: Parameters<typeof orig>[0]) => {
          await gate;
          return orig(input);
        }) as typeof orig,
      } as never);
      try {
        await user.click(confirmAll);
        expect(screen.getByRole('button', { name: /confirming/i })).toBeDisabled();
        release();
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /confirm all/i })).not.toBeInTheDocument(),
        );
      } finally {
        useSnapshotsStore.setState({ upsert: orig } as never);
      }
    });

    it('no Confirm all button when nothing is pending', async () => {
      await seedDerivedAccount('Already Done', 9000, SnapshotSource.USER_CONFIRMED);
      render(
        <MemoryRouter>
          <MonthlyMiniWindow />
        </MemoryRouter>,
      );
      await screen.findByText(/confirm last month's values/i);
      expect(screen.queryByRole('button', { name: /confirm all/i })).not.toBeInTheDocument();
    });

    it('per-card confirm still works after the batch machinery lands (prop-derived mode)', async () => {
      const user = userEvent.setup();
      const id1 = await seedDerivedAccount('Brokerage One', 5000, SnapshotSource.AUTO_DERIVED);
      await seedDerivedAccount('Brokerage Two', 7000, SnapshotSource.AUTO_DERIVED);
      render(
        <MemoryRouter>
          <MonthlyMiniWindow />
        </MemoryRouter>,
      );
      await screen.findByText(/Brokerage One/);
      // Confirm ONLY the first card via its own button.
      const confirms = screen.getAllByRole('button', { name: /^confirm (?!all)/i });
      await user.click(confirms[0]);
      const close = lastMonthCloseISO();
      await waitFor(() => {
        const s = useSnapshotsStore
          .getState()
          .snapshots.find((x) => x.accountId === id1 && x.snapshotDate === close);
        expect(s?.source).toBe(SnapshotSource.USER_CONFIRMED);
      });
      // Exactly one card flipped; the sibling stays pending. Wave-4: the
      // flip is a status announcement. Wave-5: every card (plus the batch
      // summary paragraph) pre-mounts its own role="status" span now, so
      // scope the assertion to the ones actually carrying text.
      expect(screen.getAllByText(/Confirmed/)).toHaveLength(1);
      const statusTexts = screen.getAllByRole('status').map((el) => el.textContent ?? '');
      expect(statusTexts.filter((t) => t.includes('Confirmed'))).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /^confirm (?!all)/i })).toHaveLength(1);
    });
  });
});
