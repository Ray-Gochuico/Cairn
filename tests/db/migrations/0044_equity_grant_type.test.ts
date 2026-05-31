import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0044_equity_grant_type', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    // household id=1 is seeded by 0001_initial.sql; we just need a person so
    // the FK on equity_grants.owner_person_id is satisfied.
    await db.execute(
      `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age)
       VALUES (1, 'Test Owner', '1990-01-01', 65)`,
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('adds a grant_type column', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('equity_grants') WHERE name = 'grant_type'",
    );
    expect(rows.map((r) => r.name)).toEqual(['grant_type']);
  });

  it('back-fills existing rows (inserted without grant_type) to RSU', async () => {
    // Simulate a pre-0044 row: INSERT without naming grant_type so the
    // DEFAULT 'RSU' applies — proves existing rows back-fill on migrate.
    await db.execute(
      `INSERT INTO equity_grants
       (household_id, owner_person_id, name, company_name, grant_date,
        strike_price, total_shares, vesting_schedule, current_fmv)
       VALUES (1, 1, 'Old grant', 'OldCo', '2020-01-01', 10, 1000,
               '[{"date":"2024-01-01","cumulativePct":1.0}]', 50)`,
    );
    const rows = await db.select<{ grant_type: string }>(
      'SELECT grant_type FROM equity_grants',
    );
    expect(rows[0].grant_type).toBe('RSU');
  });

  it('accepts the three valid grant types (RSU/ISO/NSO)', async () => {
    for (const gt of ['RSU', 'ISO', 'NSO'] as const) {
      await db.execute(
        `INSERT INTO equity_grants
         (household_id, owner_person_id, name, company_name, grant_date,
          strike_price, total_shares, vesting_schedule, current_fmv, grant_type)
         VALUES (1, 1, ?, 'Co', '2026-01-01', 1, 100,
                 '[{"date":"2030-01-01","cumulativePct":1.0}]', 0, ?)`,
        [`${gt} grant`, gt],
      );
    }
    const rows = await db.select<{ grant_type: string }>(
      'SELECT grant_type FROM equity_grants ORDER BY id ASC',
    );
    expect(rows.map((r) => r.grant_type)).toEqual(['RSU', 'ISO', 'NSO']);
  });

  it('rejects a grant_type outside RSU/ISO/NSO (CHECK constraint)', async () => {
    await db.execute(
      `INSERT INTO equity_grants
       (household_id, owner_person_id, name, company_name, grant_date,
        strike_price, total_shares, vesting_schedule, current_fmv)
       VALUES (1, 1, 'Grant', 'Co', '2026-01-01', 1, 100,
               '[{"date":"2030-01-01","cumulativePct":1.0}]', 0)`,
    );
    await expect(
      db.execute("UPDATE equity_grants SET grant_type = 'FOO'"),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('rejects a bad grant_type on INSERT (CHECK constraint)', async () => {
    await expect(
      db.execute(
        `INSERT INTO equity_grants
         (household_id, owner_person_id, name, company_name, grant_date,
          strike_price, total_shares, vesting_schedule, current_fmv, grant_type)
         VALUES (1, 1, 'Bad', 'Co', '2026-01-01', 1, 100,
                 '[{"date":"2030-01-01","cumulativePct":1.0}]', 0, 'ESPP')`,
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
