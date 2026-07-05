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
    // Deterministic seam for the second-granularity datetime('now') stamp:
    // pin updated_at to a known past sentinel so the strict `>` below proves
    // update() actually refreshes it. (SQLite's own clock can't be faked
    // from JS, and a 1.1s sleep — the old approach — was both slow and
    // paired with a vacuous `>=`.)
    await db.execute("UPDATE scenarios SET updated_at = '2000-01-01 00:00:00' WHERE id = ?", [id]);
    const before = await repo.findById(id);
    await repo.update(id, { name: 'Renamed', leverPayload: { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 5000, destination: 'cash' }] } });
    const after = await repo.findById(id);
    expect(after!.name).toBe('Renamed');
    expect(after!.leverPayload.lumpSums).toHaveLength(1);
    expect(before!.updatedAt).toBe('2000-01-01 00:00:00');
    expect(after!.updatedAt > before!.updatedAt).toBe(true); // STRICT — the stamp moved
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

describe('ScenariosRepo.setActive', () => {
  let db: SqliteAdapter;
  let repo: ScenariosRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new ScenariosRepo(db);
  });

  afterEach(async () => { await db.close(); });

  it('moves the active flag atomically — exactly one active row before and after', async () => {
    const baselineId = await repo.create(baseline());
    const variantId  = await repo.create(variant({ isActive: false }));

    let list = await repo.list();
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([baselineId]);

    await repo.setActive(variantId);
    list = await repo.list();
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([variantId]);
  });

  it('setActive(id) on the currently-active scenario is a no-op (still exactly one active)', async () => {
    const baselineId = await repo.create(baseline());
    await repo.setActive(baselineId);
    const list = await repo.list();
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([baselineId]);
  });

  it('setActive throws on unknown id', async () => {
    await expect(repo.setActive(999)).rejects.toThrow(/not found/);
  });

  it('the partial unique index would catch a non-transactional flip — we exercise the transaction by setting active twice in quick succession', async () => {
    const baselineId = await repo.create(baseline());
    const aId = await repo.create(variant({ name: 'A', isActive: false }));
    const bId = await repo.create(variant({ name: 'B', isActive: false }));

    await repo.setActive(aId);
    await repo.setActive(bId);
    await repo.setActive(baselineId);

    const list = await repo.list();
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([baselineId]);
  });
});

describe('ScenariosRepo.delete baseline guard', () => {
  let db: SqliteAdapter;
  let repo: ScenariosRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new ScenariosRepo(db);
  });

  afterEach(async () => { await db.close(); });

  it('refuses to delete the baseline scenario', async () => {
    const baselineId = await repo.create(baseline());
    await expect(repo.delete(baselineId)).rejects.toThrow(/cannot delete baseline/i);
    const list = await repo.list();
    expect(list.map((s) => s.id)).toContain(baselineId);
  });

  it('allows deletion of non-baseline scenarios', async () => {
    await repo.create(baseline());
    const variantId = await repo.create(variant());
    await repo.delete(variantId);
    expect((await repo.list()).map((s) => s.id)).not.toContain(variantId);
  });

  it('throws when deleting an unknown id', async () => {
    await expect(repo.delete(999)).rejects.toThrow(/not found/);
  });
});
