import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { ScenariosRepo } from '@/domain/scenarios';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

const baseline = (): Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: 'Baseline',
  isBaseline: true,
  color: '#4f86f7',
  lineStyle: 'solid',
  visible: true,
  isActive: true,
  sortOrder: 0,
  leverPayload: emptyLeverPayload(),
});

const variant = (over: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>> = {}) => ({
  ...baseline(),
  name: 'Pay-off Auto',
  isBaseline: false,
  isActive: false,
  color: '#a8c0fb',
  ...over,
});

describe('ScenariosRepo basic CRUD', () => {
  let db: SqliteAdapter;
  let repo: ScenariosRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new ScenariosRepo(db);
  });

  afterEach(async () => { await db.close(); });

  it('returns an empty list when no scenarios exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a baseline scenario and returns its id', async () => {
    const id = await repo.create(baseline());
    expect(id).toBeGreaterThan(0);
  });

  it('list() orders by sort_order ASC then id ASC', async () => {
    await repo.create(baseline());
    const b = await repo.create(variant({ name: 'B', sortOrder: 2 }));
    const a = await repo.create(variant({ name: 'A', sortOrder: 1 }));
    const c = await repo.create(variant({ name: 'C', sortOrder: 2 }));
    const list = await repo.list();
    expect(list.map((s) => s.name)).toEqual(['Baseline', 'A', 'B', 'C']);
    expect(list.find((s) => s.name === 'B')?.id).toBeLessThan(c);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('round-trips the leverPayload JSON blob through Zod', async () => {
    const id = await repo.create(variant({
      leverPayload: {
        ...emptyLeverPayload(),
        extraLoanPayments: [{ loanId: 1, extraMonthly: 300, start: '2027-01-01' }],
        lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' }],
      },
    }));
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.leverPayload.extraLoanPayments).toEqual([{ loanId: 1, extraMonthly: 300, start: '2027-01-01' }]);
    expect(found!.leverPayload.lumpSums[0].amount).toBe(25000);
  });

  it('throws on read when the stored leverPayload is malformed JSON', async () => {
    await db.execute(
      `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('Broken', 0, '#a8c0fb', 0, 'NOT JSON')`,
    );
    await expect(repo.list()).rejects.toThrow();
  });

  it('throws on read when the stored leverPayload fails Zod (wrong destination)', async () => {
    const bad = JSON.stringify({ ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'crypto' }] });
    await db.execute(
      `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('Broken', 0, '#a8c0fb', 0, ?)`,
      [bad],
    );
    await expect(repo.list()).rejects.toThrow();
  });

  it('updates fields including the JSON blob and refreshes updatedAt', async () => {
    const id = await repo.create(variant());
    const before = await repo.findById(id);
    await new Promise((r) => setTimeout(r, 1100));
    await repo.update(id, { name: 'Renamed', leverPayload: { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 5000, destination: 'cash' }] } });
    const after = await repo.findById(id);
    expect(after!.name).toBe('Renamed');
    expect(after!.leverPayload.lumpSums).toHaveLength(1);
    expect(after!.updatedAt >= before!.updatedAt).toBe(true);
  });

  it('update() rejects an unknown id', async () => {
    await expect(repo.update(999, { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('delete() removes the row', async () => {
    await repo.create(baseline());
    const id = await repo.create(variant());
    await repo.delete(id);
    const list = await repo.list();
    expect(list.map((s) => s.id)).not.toContain(id);
  });
});
