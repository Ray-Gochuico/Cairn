import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';

describe('runMarketDataRefresh', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns synchronously without throwing on an empty database', () => {
    // No accounts/holdings/tickers seeded — the three derivations are
    // fire-and-forget IIFEs that swallow their own errors. The call itself
    // must not throw and must not return a rejected promise.
    expect(() => runMarketDataRefresh(db)).not.toThrow();
  });

  it('does not reject when awaited', async () => {
    await expect(
      Promise.resolve(runMarketDataRefresh(db)),
    ).resolves.toBeUndefined();
  });
});
