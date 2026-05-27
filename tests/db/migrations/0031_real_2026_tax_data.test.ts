// Migration-level test for 0031_real_2026_tax_data.
//
// What it covers (vs. tests/lib/tax-2026-values.test.ts which tests the
// loaded engine values):
//   - The four UPDATE statements actually mutated the seeded 2026 rows
//     (i.e., the WHERE clauses matched the migration-0002 seed rows).
//   - The migration is idempotent — re-applying it produces the same end
//     state.
//
// The Wave-3 review (N5) flagged that tax-2026-values.test.ts covers the
// engine surface but not the migration body — a future migration script
// edit that breaks the WHERE clause or the JSON literal would not fire a
// test until a downstream integration test happened to fail.
//
// Source pins (verified 2026-05-27 from IRS Rev. Proc. 2025-32 via Tax
// Foundation):
//   Std deductions: SINGLE 16100, MFJ 32200, MFS 16100, HOH 24150
//   Top bracket entry: SINGLE/HOH 640600, MFJ 768700, MFS 384350
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface TaxRuleRow {
  year: number;
  jurisdiction_type: string;
  filing_status: string;
  brackets: string;
  standard_deduction: number;
}

async function loadFederalRow(
  db: SqliteAdapter,
  filingStatus: string,
): Promise<TaxRuleRow> {
  const rows = await db.select<TaxRuleRow>(
    `SELECT year, jurisdiction_type, filing_status, brackets, standard_deduction
     FROM tax_rules
     WHERE year = 2026
       AND jurisdiction_type = 'FEDERAL'
       AND jurisdiction_code = 'US'
       AND filing_status = ?`,
    [filingStatus],
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('0031_real_2026_tax_data', () => {
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
      `SELECT version FROM schema_migrations WHERE version = '0031_real_2026_tax_data'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('sets SINGLE 2026 standard_deduction = 16100', async () => {
    const row = await loadFederalRow(db, 'SINGLE');
    expect(row.standard_deduction).toBe(16100);
  });

  it('sets MFJ 2026 standard_deduction = 32200', async () => {
    const row = await loadFederalRow(db, 'MFJ');
    expect(row.standard_deduction).toBe(32200);
  });

  it('sets MFS 2026 standard_deduction = 16100', async () => {
    const row = await loadFederalRow(db, 'MFS');
    expect(row.standard_deduction).toBe(16100);
  });

  it('sets HOH 2026 standard_deduction = 24150', async () => {
    const row = await loadFederalRow(db, 'HOH');
    expect(row.standard_deduction).toBe(24150);
  });

  it('SINGLE brackets parse as JSON with the 7-bracket 2026 schedule', async () => {
    const row = await loadFederalRow(db, 'SINGLE');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets).toHaveLength(7);
    // First bracket starts at 0 at 10%; last bracket has min = 640600 and max = null (top rate).
    expect(brackets[0]).toEqual({ min: 0, max: 12400, rate: 0.10 });
    expect(brackets[6]).toEqual({ min: 640600, max: null, rate: 0.37 });
  });

  it('MFJ brackets parse as JSON with top rate starting at 768700', async () => {
    const row = await loadFederalRow(db, 'MFJ');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets[6]).toEqual({ min: 768700, max: null, rate: 0.37 });
  });

  it('MFS brackets use the half-MFJ top entry at 384350', async () => {
    const row = await loadFederalRow(db, 'MFS');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets[6]).toEqual({ min: 384350, max: null, rate: 0.37 });
  });

  it('HOH first three brackets follow 10%/12%/22% with the HOH-specific 17700/67450/105700 thresholds', async () => {
    const row = await loadFederalRow(db, 'HOH');
    const brackets = JSON.parse(row.brackets) as Array<{ min: number; max: number | null; rate: number }>;
    expect(brackets[0]).toEqual({ min: 0, max: 17700, rate: 0.10 });
    expect(brackets[1]).toEqual({ min: 17700, max: 67450, rate: 0.12 });
    expect(brackets[2]).toEqual({ min: 67450, max: 105700, rate: 0.22 });
  });

  it('is idempotent — running loadAllMigrations() twice leaves the same values', async () => {
    const beforeRow = await loadFederalRow(db, 'SINGLE');
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
    const afterRow = await loadFederalRow(db, 'SINGLE');
    expect(afterRow.standard_deduction).toBe(beforeRow.standard_deduction);
    expect(afterRow.brackets).toBe(beforeRow.brackets);
  });

  it('does not affect non-FEDERAL jurisdictions (e.g., state-level CA rows)', async () => {
    // 0031's WHERE clause pins jurisdiction_type = 'FEDERAL'. A regression
    // that dropped that filter would mangle every state row.
    const stateRows = await db.select<TaxRuleRow>(
      `SELECT year, jurisdiction_type, filing_status, brackets, standard_deduction
       FROM tax_rules
       WHERE year = 2026
         AND jurisdiction_type = 'STATE'
       LIMIT 1`,
    );
    if (stateRows.length > 0) {
      // If a state row exists in seed data, its standard_deduction should
      // NOT match the federal SINGLE value (16100) by accident.
      const fedSingle = await loadFederalRow(db, 'SINGLE');
      expect(stateRows[0].standard_deduction).not.toBe(fedSingle.standard_deduction);
    }
    // If no STATE 2026 row exists, this test is a no-op; the seed evolves
    // and we don't want to pin the state set here.
  });
});
