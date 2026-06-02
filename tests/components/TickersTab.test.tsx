import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTickersStore } from '@/stores/tickers-store';
import { AssetClass, Direction } from '@/types/schema';
import TickersTab from '@/pages/inputs/TickersTab';

// The seeded DB ships system tickers too, each with a (disabled) Delete
// button. Scope to the MSTR row's own Delete so the query is unambiguous.
function mstrRowDeleteButton(): HTMLElement {
  const row = screen
    .getAllByTestId('tickers-row')
    .find((r) => within(r).queryByText('MSTR'));
  if (!row) throw new Error('MSTR row not found');
  return within(row).getByRole('button', { name: /^delete$/i });
}

async function seedUserTicker(ticker: string) {
  await useTickersStore.getState().upsert({
    ticker,
    name: null,
    assetClass: AssetClass.SINGLE_STOCK,
    leverageFactor: 1,
    direction: Direction.LONG,
    userAdded: true,
    accentColor: null,
    sector: null,
    industry: null,
  });
}

describe('TickersTab — delete confirmation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useTickersStore.setState({ tickers: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('clicking Delete on a user-added ticker opens a confirm and does NOT remove yet', async () => {
    await seedUserTicker('MSTR');
    const user = userEvent.setup();
    render(<MemoryRouter><TickersTab /></MemoryRouter>);

    await screen.findByText('MSTR');
    await user.click(mstrRowDeleteButton());

    // Not removed synchronously; dialog appears and warns about orphaned holdings.
    expect(useTickersStore.getState().tickers.some((t) => t.ticker === 'MSTR')).toBe(true);
    expect(await screen.findByText(/delete mstr\?/i)).toBeInTheDocument();
    expect(screen.getByText(/without ticker details/i)).toBeInTheDocument();
  });

  it('Cancel keeps the ticker; Confirm removes it', async () => {
    await seedUserTicker('MSTR');
    const user = userEvent.setup();
    render(<MemoryRouter><TickersTab /></MemoryRouter>);

    await screen.findByText('MSTR');

    // Cancel path
    await user.click(mstrRowDeleteButton());
    await screen.findByText(/delete mstr\?/i);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.queryByText(/delete mstr\?/i)).not.toBeInTheDocument(),
    );
    expect(useTickersStore.getState().tickers.some((t) => t.ticker === 'MSTR')).toBe(true);

    // Confirm path
    await user.click(mstrRowDeleteButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(useTickersStore.getState().tickers.some((t) => t.ticker === 'MSTR')).toBe(false),
    );
  });
});
