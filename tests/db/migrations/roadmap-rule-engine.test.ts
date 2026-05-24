import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
}

describe('roadmap-rule-engine migration (0018)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('adds the threshold-override columns to household as nullable REAL', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('household')");
    const byName = new Map(info.map((c) => [c.name, c]));
    for (const col of ['interest_threshold_low_pct', 'interest_threshold_high_pct']) {
      const c = byName.get(col);
      expect(c, col).toBeDefined();
      expect(c!.type).toBe('REAL');
      expect(c!.notnull).toBe(0);
    }
  });

  it('adds the household-level chart-answer columns', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('household')");
    const cols = new Set(info.map((c) => c.name));
    for (const col of [
      'has_written_ips',
      'has_hsa_qualified_hdhp',
      'makes_charitable_gifts',
      'upcoming_large_purchase',
      'upcoming_purchase_amount',
      'upcoming_purchase_months',
    ]) {
      expect(cols.has(col), col).toBe(true);
    }
  });

  it('adds the person-level chart-answer columns', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('persons')");
    const byName = new Map(info.map((c) => [c.name, c]));
    expect(byName.get('job_stability')?.type).toBe('TEXT');
    expect(byName.get('expects_higher_future_income')?.type).toBe('INTEGER');
    expect(byName.get('on_parent_health_insurance')?.type).toBe('INTEGER');
    expect(byName.get('is_relatively_healthy')?.type).toBe('INTEGER');
  });

  it('adds the account-level chart-answer columns', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('accounts')");
    const cols = new Set(info.map((c) => c.name));
    for (const col of [
      'has_employer_match',
      'employer_match_pct',
      'employer_match_limit_pct',
      'allows_mega_backdoor_rollover',
      'has_high_fees',
    ]) {
      expect(cols.has(col), col).toBe(true);
    }
  });

  it('creates the roadmap_node_overrides table with UNIQUE(household, node)', async () => {
    await db.execute(
      `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
       VALUES (1, 's1_emergency_small', 'done', '2026-05-23T00:00:00Z')`,
    );
    await expect(
      db.execute(
        `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
         VALUES (1, 's1_emergency_small', 'skipped', '2026-05-24T00:00:00Z')`,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('allows overrides for different nodes on the same household', async () => {
    await db.execute(
      `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
       VALUES (1, 's1_emergency_small', 'done', '2026-05-23T00:00:00Z')`,
    );
    await db.execute(
      `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
       VALUES (1, 's0_create_budget', 'skipped', '2026-05-23T00:00:00Z')`,
    );
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM roadmap_node_overrides`,
    );
    expect(rows[0].count).toBe(2);
  });

  it('leaves the seeded household row with NULL chart-answer columns', async () => {
    const rows = await db.select<Record<string, unknown>>(
      `SELECT interest_threshold_low_pct, has_written_ips, has_hsa_qualified_hdhp FROM household WHERE id = 1`,
    );
    expect(rows[0].interest_threshold_low_pct).toBeNull();
    expect(rows[0].has_written_ips).toBeNull();
    expect(rows[0].has_hsa_qualified_hdhp).toBeNull();
  });
});
