import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTickersStore } from '@/stores/tickers-store';
import { TickersRepo } from '@/domain/tickers';
import type { Ticker } from '@/types/schema';

const sampleTicker = (): Ticker => ({
  ticker: 'VTI',
  name: 'Vanguard Total Stock Market ETF',
  assetClass: 'US_TOTAL_MARKET',
  leverageFactor: 1.0,
  direction: 'LONG',
  userAdded: false,
  accentColor: null,
});

describe('useTickersStore', () => {
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

  it('setAccentColor writes the color and refreshes the store', async () => {
    await new TickersRepo(db).upsert(sampleTicker());
    await useTickersStore.getState().load();
    expect(useTickersStore.getState().lookup('VTI')?.accentColor).toBeNull();

    await useTickersStore.getState().setAccentColor('VTI', '#54a24b');
    expect(useTickersStore.getState().lookup('VTI')?.accentColor).toBe('#54a24b');

    await useTickersStore.getState().setAccentColor('VTI', null);
    expect(useTickersStore.getState().lookup('VTI')?.accentColor).toBeNull();
  });
});
