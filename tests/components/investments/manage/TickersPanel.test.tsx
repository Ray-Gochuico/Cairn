import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTickersStore } from '@/stores/tickers-store';
import { AssetClass, Direction } from '@/types/schema';
import TickersPanel from '@/components/investments/manage/TickersPanel';

function mstrRowDeleteButton(): HTMLElement {
  const row = screen
    .getAllByTestId('tickers-row')
    .find((r) => within(r).queryByText('MSTR'));
  if (!row) throw new Error('MSTR row not found');
  return within(row).getByRole('button', { name: /^delete mstr$/i });
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

describe('TickersPanel (W14 Manage surface)', () => {
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
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);

    await screen.findByText('MSTR');
    await user.click(mstrRowDeleteButton());

    expect(useTickersStore.getState().tickers.some((t) => t.ticker === 'MSTR')).toBe(true);
    expect(await screen.findByText(/delete mstr\?/i)).toBeInTheDocument();
    expect(screen.getByText(/without ticker details/i)).toBeInTheDocument();
  });

  it('system rows have no Delete control at all', async () => {
    const user = userEvent.setup();
    await seedUserTicker('MYCO');
    await useTickersStore.getState().load();
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);
    await screen.findByText('MYCO');
    await user.type(screen.getByRole('searchbox', { name: /search tickers/i }), 'MYCO');
    expect(screen.getAllByRole('button', { name: /^delete/i })).toHaveLength(1);
  });

  it('filters the ticker list by symbol or name via the search box', async () => {
    const user = userEvent.setup();
    await useTickersStore.getState().load();
    await useTickersStore.getState().upsert({
      ticker: 'ZZZA', name: 'Apple-like Co', assetClass: AssetClass.SINGLE_STOCK,
      leverageFactor: 1, direction: Direction.LONG, userAdded: true, accentColor: null, sector: null, industry: null,
    });
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);
    await screen.findByText('ZZZA');
    await user.type(screen.getByRole('searchbox', { name: /search tickers/i }), 'apple-like');
    expect(screen.getByText('ZZZA')).toBeInTheDocument();
    expect(screen.queryByText('MSTR')).not.toBeInTheDocument();
  });

  it('New ticker opens the create drawer; saving upserts a user-added row and closes', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /new ticker/i }));

    const drawer = await screen.findByRole('dialog', { name: /new ticker/i });
    await user.type(within(drawer).getByLabelText(/ticker symbol/i), 'ZQXY');
    await user.click(within(drawer).getByRole('button', { name: /create/i }));

    await waitFor(() => {
      const t = useTickersStore.getState().tickers.find((x) => x.ticker === 'ZQXY');
      expect(t).toBeDefined();
      expect(t?.userAdded).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('row Edit opens a prefilled drawer; saving preserves userAdded', async () => {
    await seedUserTicker('MSTR');
    const user = userEvent.setup();
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);
    await screen.findByText('MSTR');

    const row = screen
      .getAllByTestId('tickers-row')
      .find((r) => within(r).queryByText('MSTR'))!;
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    const drawer = await screen.findByRole('dialog', { name: /edit ticker/i });
    expect(within(drawer).getByLabelText(/ticker symbol/i)).toHaveValue('MSTR');
    const name = within(drawer).getByLabelText(/name/i);
    await user.type(name, 'MicroStrategy');
    await user.click(within(drawer).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const t = useTickersStore.getState().tickers.find((x) => x.ticker === 'MSTR');
      expect(t?.name).toBe('MicroStrategy');
      expect(t?.userAdded).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('announces the visible count politely', async () => {
    const user = userEvent.setup();
    await seedUserTicker('ZQXY');
    await useTickersStore.getState().load();
    const total = useTickersStore.getState().tickers.length;
    render(<MemoryRouter><TickersPanel /></MemoryRouter>);
    const status = await screen.findByTestId('tickers-visible-count');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(`${total} of ${total} tickers`);
    await user.type(screen.getByRole('searchbox', { name: /search tickers/i }), 'ZQXY');
    expect(status).toHaveTextContent(`1 of ${total} tickers`);
  });
});
