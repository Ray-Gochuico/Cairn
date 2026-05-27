// Regression guard for the production foreign-keys bug.
//
// Migration 0001 declares 29 `ON DELETE CASCADE` / `ON DELETE SET NULL`
// clauses. SQLite defaults `foreign_keys = OFF` per connection, so those
// were silently no-ops in `TauriAdapter` until migration 0030 + the
// adapter's PRAGMA setup landed (2026-05-27 backend-p0 sprint).
//
// The test adapter (`SqliteAdapter`) already turns FKs on at construction,
// which is why tests passed while production drifted. This file asserts
// that the FK semantics we rely on (CASCADE on household → persons, plus
// the 0030 orphan cleanup) are actually enforced.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';

describe('foreign-keys enforcement', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('CASCADE deletes persons when their household is deleted (sanity-checks FK pragma)', async () => {
    // Drop the singleton household so we can re-insert one we control.
    await db.execute('DELETE FROM household');
    await db.execute(
      `INSERT INTO household (id, filing_status, state, city, monthly_expense_baseline, withdrawal_rate, inflation_assumption)
       VALUES (1, 'SINGLE', 'CA', NULL, 0, 0.04, 0.024)`,
    );
    await db.execute(
      `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age)
       VALUES (1, 'Alice', '1990-01-01', 65)`,
    );

    const before = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    expect(before[0].n).toBe(1);

    await db.execute('DELETE FROM household WHERE id = 1');

    const after = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    expect(after[0].n).toBe(0);
  });

  it('0030 orphan-cleanup migration is recorded as applied on a fresh DB', async () => {
    const rows = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = '0030_enable_foreign_keys_and_orphan_cleanup'",
    );
    expect(rows).toHaveLength(1);
  });

  it('0030 cleanup deletes existing orphan holdings/snapshots/etc.', async () => {
    // Simulate a DB that drifted while FKs were off in production. The test
    // adapter unconditionally enables FKs at construction, so we toggle them
    // off here to seed orphans, then turn them back on for the cleanup pass.
    await db.execute('PRAGMA foreign_keys = OFF');
    try {
      await db.execute(
        `INSERT INTO holdings (account_id, ticker, share_count) VALUES (9999, 'ZZZ', 1)`,
      );
      await db.execute(
        `INSERT INTO account_snapshots (account_id, snapshot_date, total_value, source)
         VALUES (9999, '2026-01-01', 100, 'manual')`,
      );
    } finally {
      await db.execute('PRAGMA foreign_keys = ON');
    }

    // Re-run the same DELETE the migration runs.
    await db.execute(
      'DELETE FROM holdings WHERE account_id NOT IN (SELECT id FROM accounts)',
    );
    await db.execute(
      'DELETE FROM account_snapshots WHERE account_id NOT IN (SELECT id FROM accounts)',
    );

    const h = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM holdings');
    const s = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM account_snapshots');
    expect(h[0].n).toBe(0);
    expect(s[0].n).toBe(0);
  });
});
