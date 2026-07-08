import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const loadAssetSnapshotsMigration = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0026_asset_value_snapshots.sql'),
    'utf-8',
  );

describe('AssetValueSnapshotsRepo', () => {
  let db: SqliteAdapter;
  let repo: AssetValueSnapshotsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0026_asset_value_snapshots', sql: loadAssetSnapshotsMigration() },
    ]);
    repo = new AssetValueSnapshotsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty list before any snapshots exist', async () => {
    expect(await repo.list()).toEqual([]);
    expect(await repo.listForOwner('PROPERTY', 1)).toEqual([]);
  });

  it('creates and lists snapshots for a property', async () => {
    await repo.create({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-01-01',
      value: 400000,
    });
    await repo.create({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-04-01',
      value: 410000,
    });
    const rows = await repo.listForOwner('PROPERTY', 1);
    expect(rows).toHaveLength(2);
    // listForOwner returns newest first
    expect(rows[0].snapshotDate).toBe('2026-04-01');
    expect(rows[0].value).toBe(410000);
    expect(rows[1].snapshotDate).toBe('2026-01-01');
  });

  it('listForOwner is scoped by ownerType and ownerId', async () => {
    await repo.create({ ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-01', value: 100 });
    await repo.create({ ownerType: 'PROPERTY', ownerId: 2, snapshotDate: '2026-01-01', value: 200 });
    await repo.create({ ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-01-01', value: 300 });
    expect((await repo.listForOwner('PROPERTY', 1)).map((r) => r.value)).toEqual([100]);
    expect((await repo.listForOwner('PROPERTY', 2)).map((r) => r.value)).toEqual([200]);
    expect((await repo.listForOwner('VEHICLE', 1)).map((r) => r.value)).toEqual([300]);
    expect(await repo.listForOwner('VEHICLE', 2)).toEqual([]);
  });

  it('list returns all snapshots across owners ordered by snapshot_date desc', async () => {
    await repo.create({ ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-01', value: 100 });
    await repo.create({ ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-03-01', value: 300 });
    await repo.create({ ownerType: 'PROPERTY', ownerId: 2, snapshotDate: '2026-02-01', value: 200 });
    const rows = await repo.list();
    expect(rows.map((r) => r.snapshotDate)).toEqual([
      '2026-03-01',
      '2026-02-01',
      '2026-01-01',
    ]);
  });

  it('updates a snapshot value', async () => {
    const id = await repo.create({
      ownerType: 'VEHICLE',
      ownerId: 1,
      snapshotDate: '2026-01-01',
      value: 25000,
    });
    await repo.update(id, { value: 22000 });
    const rows = await repo.listForOwner('VEHICLE', 1);
    expect(rows[0].value).toBe(22000);
    expect(rows[0].snapshotDate).toBe('2026-01-01'); // unchanged
  });

  it('updates a snapshot date', async () => {
    const id = await repo.create({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-01-01',
      value: 500000,
    });
    await repo.update(id, { snapshotDate: '2026-02-15' });
    const rows = await repo.listForOwner('PROPERTY', 1);
    expect(rows[0].snapshotDate).toBe('2026-02-15');
    expect(rows[0].value).toBe(500000); // unchanged
  });

  it('update throws on unknown id', async () => {
    await expect(repo.update(999, { value: 1 })).rejects.toThrow();
  });

  it('deletes a single snapshot', async () => {
    const id = await repo.create({
      ownerType: 'VEHICLE',
      ownerId: 1,
      snapshotDate: '2026-01-01',
      value: 25000,
    });
    await repo.delete(id);
    expect(await repo.listForOwner('VEHICLE', 1)).toHaveLength(0);
  });

  it('deleteForOwner clears all snapshots for one entity', async () => {
    await repo.create({ ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-01', value: 100 });
    await repo.create({ ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-02-01', value: 110 });
    await repo.create({ ownerType: 'PROPERTY', ownerId: 2, snapshotDate: '2026-01-01', value: 200 });
    await repo.create({ ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-01-01', value: 25000 });
    await repo.deleteForOwner('PROPERTY', 1);
    expect(await repo.listForOwner('PROPERTY', 1)).toHaveLength(0);
    expect(await repo.listForOwner('PROPERTY', 2)).toHaveLength(1);
    expect(await repo.listForOwner('VEHICLE', 1)).toHaveLength(1);
  });

  it('rejects negative values on create', async () => {
    await expect(
      repo.create({
        ownerType: 'PROPERTY',
        ownerId: 1,
        snapshotDate: '2026-01-01',
        value: -1,
      }),
    ).rejects.toThrow();
  });

  it('rejects malformed dates on create', async () => {
    await expect(
      repo.create({
        ownerType: 'PROPERTY',
        ownerId: 1,
        snapshotDate: '2026/01/01',
        value: 100,
      }),
    ).rejects.toThrow();
  });

  describe('buildUpsertForDateStatement (wave-7 W2 — batch-friendly seam)', () => {
    it('returns an INSERT when no row exists for (owner, date) and executes in a batch', async () => {
      const stmt = await repo.buildUpsertForDateStatement('PROPERTY', 7, '2026-07-07', 500_000);
      await db.executeBatch([stmt], { transaction: true });
      const rows = await db.select<{ value: number }>(
        `SELECT value FROM asset_value_snapshots WHERE owner_type = 'PROPERTY' AND owner_id = 7 AND snapshot_date = '2026-07-07'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(500_000);
    });

    it('returns an UPDATE for an existing same-date row — no duplicate rows', async () => {
      await repo.create({ ownerType: 'PROPERTY', ownerId: 7, snapshotDate: '2026-07-07', value: 480_000 });
      const stmt = await repo.buildUpsertForDateStatement('PROPERTY', 7, '2026-07-07', 505_000);
      await db.executeBatch([stmt], { transaction: true });
      const rows = await db.select<{ value: number }>(
        `SELECT value FROM asset_value_snapshots WHERE owner_type = 'PROPERTY' AND owner_id = 7 AND snapshot_date = '2026-07-07'`,
      );
      expect(rows).toHaveLength(1); // upsert, not append
      expect(rows[0].value).toBe(505_000);
    });

    it('scopes by owner type: a VEHICLE row at the same id/date does not collide', async () => {
      await repo.create({ ownerType: 'VEHICLE', ownerId: 7, snapshotDate: '2026-07-07', value: 30_000 });
      const stmt = await repo.buildUpsertForDateStatement('PROPERTY', 7, '2026-07-07', 500_000);
      await db.executeBatch([stmt], { transaction: true });
      const all = await db.select<{ owner_type: string; value: number }>(
        `SELECT owner_type, value FROM asset_value_snapshots WHERE owner_id = 7 AND snapshot_date = '2026-07-07' ORDER BY owner_type`,
      );
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.owner_type)).toEqual(['PROPERTY', 'VEHICLE']);
    });
  });
});
