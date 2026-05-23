import { describe, it, expect } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('ticker-sector-industry migration', () => {
  it('adds sector and industry as nullable TEXT', async () => {
    const db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    const info = await db.select<any>("PRAGMA table_info('tickers')");
    const sector = info.find((c: any) => c.name === 'sector');
    const industry = info.find((c: any) => c.name === 'industry');
    expect(sector).toBeDefined();
    expect(sector.type).toBe('TEXT');
    expect(sector.notnull).toBe(0);
    expect(industry).toBeDefined();
    expect(industry.type).toBe('TEXT');
    expect(industry.notnull).toBe(0);
  });

  it('seeded tickers (from 0006_seed_tickers) have null sector', async () => {
    const db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    const r = await db.select<any>(`SELECT ticker, sector FROM tickers LIMIT 1`);
    if (r.length) expect(r[0].sector).toBeNull();
  });
});
