import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0027_equity_grant_company_valuation', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    // The household row id=1 is seeded by 0001_initial.sql; we just need a
    // person so the FK on equity_grants.owner_person_id is satisfied.
    await db.execute(
      `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age)
       VALUES (1, 'Test Owner', '1990-01-01', 65)`,
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('adds company_valuation, company_outstanding_shares, company_total_debt columns', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('equity_grants') WHERE name IN ('company_valuation', 'company_outstanding_shares', 'company_total_debt')",
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'company_outstanding_shares',
      'company_total_debt',
      'company_valuation',
    ]);
  });

  it('allows NULL for all three new columns (existing rows unaffected)', async () => {
    await db.execute(
      `INSERT INTO equity_grants
       (household_id, owner_person_id, name, company_name, grant_date,
        strike_price, total_shares, vesting_schedule, current_fmv)
       VALUES (1, 1, 'Old grant', 'OldCo', '2020-01-01', 10, 1000,
               '[{"date":"2024-01-01","cumulativePct":1.0}]', 50)`,
    );
    const rows = (await db.select(
      'SELECT company_valuation, company_outstanding_shares, company_total_debt FROM equity_grants',
    )) as Array<{
      company_valuation: number | null;
      company_outstanding_shares: number | null;
      company_total_debt: number | null;
    }>;
    expect(rows[0].company_valuation).toBeNull();
    expect(rows[0].company_outstanding_shares).toBeNull();
    expect(rows[0].company_total_debt).toBeNull();
  });

  it('accepts non-null values for the new columns', async () => {
    await db.execute(
      `INSERT INTO equity_grants
       (household_id, owner_person_id, name, company_name, grant_date,
        strike_price, total_shares, vesting_schedule, current_fmv,
        company_valuation, company_outstanding_shares, company_total_debt)
       VALUES (1, 1, 'New grant', 'NewCo', '2026-01-01', 1, 1000,
               '[{"date":"2030-01-01","cumulativePct":1.0}]', 0,
               10000000, 5000000, 2000000)`,
    );
    const rows = (await db.select(
      'SELECT company_valuation, company_outstanding_shares, company_total_debt FROM equity_grants',
    )) as Array<{
      company_valuation: number;
      company_outstanding_shares: number;
      company_total_debt: number;
    }>;
    expect(rows[0].company_valuation).toBe(10000000);
    expect(rows[0].company_outstanding_shares).toBe(5000000);
    expect(rows[0].company_total_debt).toBe(2000000);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
