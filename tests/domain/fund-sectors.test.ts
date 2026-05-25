import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadMigration = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

describe('FundSectorsRepo', () => {
  let db: SqliteAdapter;
  let repo: FundSectorsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadMigration('0001_initial') },
      { version: '0021_fund_sectors', sql: loadMigration('0021_fund_sectors') },
    ]);
    repo = new FundSectorsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForFund returns empty for unknown fund', async () => {
    const result = await repo.listForFund('VTI');
    expect(result).toEqual([]);
  });

  it('upsertSectors inserts rows and listForFund returns them sorted desc by weight', async () => {
    await repo.upsertSectors(
      'VTI',
      [
        { sector: 'Healthcare', weight: 0.12 },
        { sector: 'Technology', weight: 0.28 },
        { sector: 'Financial Services', weight: 0.14 },
      ],
      '2025-01-15',
    );
    const sectors = await repo.listForFund('VTI');
    expect(sectors).toHaveLength(3);
    expect(sectors[0].sector).toBe('Technology');
    expect(sectors[0].weight).toBeCloseTo(0.28, 4);
    expect(sectors[1].sector).toBe('Financial Services');
    expect(sectors[2].sector).toBe('Healthcare');
    expect(sectors[0].fundTicker).toBe('VTI');
    expect(sectors[0].asOfDate).toBe('2025-01-15');
  });

  it('upsertSectors replaces previous sectors for a fund (no stale rows)', async () => {
    await repo.upsertSectors(
      'VTI',
      [{ sector: 'Technology', weight: 0.30 }, { sector: 'Healthcare', weight: 0.10 }],
      '2025-01-15',
    );
    await repo.upsertSectors(
      'VTI',
      [{ sector: 'Technology', weight: 0.32 }],
      '2025-04-01',
    );
    const sectors = await repo.listForFund('VTI');
    expect(sectors).toHaveLength(1);
    expect(sectors[0].weight).toBeCloseTo(0.32, 4);
    expect(sectors[0].asOfDate).toBe('2025-04-01');
  });

  it('listAll returns all sectors across all funds', async () => {
    await repo.upsertSectors('VTI', [{ sector: 'Technology', weight: 0.28 }], '2025-01-15');
    await repo.upsertSectors('VXUS', [{ sector: 'Financial Services', weight: 0.18 }], '2025-01-15');
    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    const tickers = all.map((s) => s.fundTicker).sort();
    expect(tickers).toEqual(['VTI', 'VXUS']);
  });

  it('upsertSectors rejects weight > 1 via schema validation', async () => {
    await expect(
      repo.upsertSectors('VTI', [{ sector: 'Technology', weight: 1.5 }], '2025-01-15'),
    ).rejects.toThrow();
  });

  it('getAsOf returns null when no sector rows exist for the fund', async () => {
    expect(await repo.getAsOf('VTI')).toBeNull();
  });

  it('getAsOf returns the most recent as_of_date', async () => {
    await repo.upsertSectors('VTI', [{ sector: 'Technology', weight: 0.28 }], '2025-04-01');
    expect(await repo.getAsOf('VTI')).toBe('2025-04-01');
  });
});
