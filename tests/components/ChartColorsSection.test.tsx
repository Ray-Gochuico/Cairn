import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { ChartColorsSection } from '@/components/settings/ChartColorsSection';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { TickersRepo } from '@/domain/tickers';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { SWATCH_OPTIONS } from '@/components/charts/palette';

describe('ChartColorsSection', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
    useTickersStore.setState({ tickers: [], isLoading: false, error: null });

    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
      name: 'Brokerage', institution: null, type: 'ACCOUNT_BROKERAGE',
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
      stateOfPlan: null, accentColor: null,
    });
    const tickersRepo = new TickersRepo(db);
    await tickersRepo.upsert({
      ticker: 'VTI', name: 'Vanguard Total Stock Market ETF',
      assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG',
      userAdded: false, accentColor: null, sector: null, industry: null,
    });
    const holdingsRepo = new HoldingsRepo(db);
    await holdingsRepo.create({
      accountId, ticker: 'VTI', shareCount: 10,
      targetAllocationPct: null, costBasis: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the Chart colors card with an account row and a ticker row', async () => {
    render(<MemoryRouter><ChartColorsSection /></MemoryRouter>);
    expect(screen.getByText('Chart colors')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Brokerage')).toBeInTheDocument();
      expect(screen.getByText('VTI')).toBeInTheDocument();
    });
  });

  it('picking a swatch for an account writes accentColor through the store', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChartColorsSection /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Brokerage')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit color for Brokerage/i }));
    await user.click(screen.getByRole('button', { name: `Color ${SWATCH_OPTIONS[0]}` }));

    await waitFor(async () => {
      const account = (await new AccountsRepo(db).list())[0];
      expect(account.accentColor).toBe(SWATCH_OPTIONS[0]);
    });
  });

  it('picking a swatch for a ticker writes accentColor through the store', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChartColorsSection /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('VTI')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit color for VTI/i }));
    await user.click(screen.getByRole('button', { name: `Color ${SWATCH_OPTIONS[5]}` }));

    await waitFor(async () => {
      const ticker = await new TickersRepo(db).lookup('VTI');
      expect(ticker?.accentColor).toBe(SWATCH_OPTIONS[5]);
    });
  });

  it('swatch popover is a dialog with Esc-close and focus restore', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChartColorsSection /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Brokerage')).toBeInTheDocument());
    const trigger = screen.getAllByRole('button', { name: /edit color for/i })[0];
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('the Default tile clears an account override back to null', async () => {
    const user = userEvent.setup();
    await new AccountsRepo(db).update(1, { accentColor: '#4c78a8' });
    render(<MemoryRouter><ChartColorsSection /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Brokerage')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit color for Brokerage/i }));
    await user.click(screen.getByRole('button', { name: /default color/i }));

    await waitFor(async () => {
      const account = (await new AccountsRepo(db).list())[0];
      expect(account.accentColor).toBeNull();
    });
  });
});
