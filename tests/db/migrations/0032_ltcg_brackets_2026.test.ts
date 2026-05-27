// Migration-level test for 0032_ltcg_brackets_2026.
//
// Covers the migration body itself (vs. tests/lib/tax-2026-ltcg-seeded.test.ts
// which covers the engine surface). 0032 adds four rows with a new
// jurisdiction_type 'FEDERAL_LTCG' that sits beside the existing 'FEDERAL'
// rows in tax_rules.
//
// Source pins (verified 2026-05-27 from Tax Foundation 2026 brackets, which
// mirrors IRS Rev. Proc. 2025-32):
//   SINGLE: 0% to 49450, 15% to 545500, 20% above
//   MFJ:    0% to 98900, 15% to 613700, 20% above
//   HOH:    0% to 66200, 15% to 579600, 20% above
//   MFS:    0% to 49450, 15% to 306850, 20% above (half-MFJ convention)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface LtcgRow {
  filing_status: string;
  brackets: string;
  standard_deduction: number;
}

async function loadLtcgRow(
  db: SqliteAdapter,
  filingStatus: string,
): Promise<LtcgRow> {
  const rows = await db.select<LtcgRow>(
    `SELECT filing_status, brackets, standard_deduction
     FROM tax_rules
     WHERE year = 2026
       AND jurisdiction_type = 'FEDERAL_LTCG'
       AND jurisdiction_code = 'US'
       AND filing_status = ?`,
    [filingStatus],
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('0032_ltcg_brackets_2026', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('is recorded in schema_migrations after loadAllMigrations()', async () => {
    const rows = await db.select<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0032_ltcg_brackets_2026'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('inserts exactly 4 FEDERAL_LTCG 2026 rows (one per filing status)', async () => {
    const rows = await db.select<{ filing_status: string }>(
      `SELECT filing_status FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'`,
    );
    expect(rows).toHaveLength(4);
    const statuses = rows.map((r) => r.filing_status).sort();
    expect(statuses).toEqual(['HOH', 'MFJ', 'MFS', 'SINGLE']);
  });

  it('LTCG rows have standard_deduction = 0 (LTCG stacks on top of ordinary income post-SD)', async () => {
    const rows = await db.select<{ standard_deduction: number }>(
      `SELECT standard_deduction FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'`,
    );
    for (const row of rows) {
      expect(row.standard_deduction).toBe(0);
    }
  });

  it('SINGLE LTCG schedule: 0% / 15% to 545500 / 20%', async () => {
    const row = await loadLtcgRow(db, 'SINGLE');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets).toEqual([
      { min: 0, max: 49450, rate: 0.0 },
      { min: 49450, max: 545500, rate: 0.15 },
      { min: 545500, max: null, rate: 0.20 },
    ]);
  });

  it('MFJ LTCG schedule: 0% / 15% to 613700 / 20%', async () => {
    const row = await loadLtcgRow(db, 'MFJ');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets).toEqual([
      { min: 0, max: 98900, rate: 0.0 },
      { min: 98900, max: 613700, rate: 0.15 },
      { min: 613700, max: null, rate: 0.20 },
    ]);
  });

  it('MFS uses the half-MFJ convention (0% to 49450, 15% to 306850)', async () => {
    const row = await loadLtcgRow(db, 'MFS');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets[1].max).toBe(306850);
    expect(brackets[2].rate).toBe(0.20);
  });

  it('HOH LTCG schedule: 0% to 66200, 15% to 579600, 20% above', async () => {
    const row = await loadLtcgRow(db, 'HOH');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets[0].max).toBe(66200);
    expect(brackets[1].max).toBe(579600);
  });

  it('does NOT touch the existing FEDERAL rows (sanity check on the new jurisdiction_type pattern)', async () => {
    // 0032 uses jurisdiction_type='FEDERAL_LTCG' precisely so it does not
    // collide with the FEDERAL rows. If a regression dropped FEDERAL_LTCG
    // and used FEDERAL instead, the UNIQUE(year, jurisdiction_type,
    // jurisdiction_code, filing_status) constraint from 0001 would refuse
    // the second INSERT and the migration would fail to apply. This test
    // pins that the two row-sets are separate.
    const federalCount = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US'`,
    );
    expect(federalCount[0].n).toBeGreaterThanOrEqual(4); // ≥ one per filing status
  });

  it('is idempotent — INSERT OR IGNORE prevents duplicates on re-run', async () => {
    const before = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'`,
    );
    expect(before[0].n).toBe(4);

    // Force a re-run of the INSERT statements by manually applying the
    // migration body (re-running loadAllMigrations skips it via the
    // applied-set in schema_migrations). The INSERT OR IGNORE clauses
    // protect against UNIQUE violations.
    const m0032 = (await import('@/db/migrations/0032_ltcg_brackets_2026.sql?raw')).default;
    await runMigrations(db, [{ version: '0032_ltcg_brackets_2026__rerun', sql: m0032 }]);

    const after = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'`,
    );
    expect(after[0].n).toBe(4);
  });
});
