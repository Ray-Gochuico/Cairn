import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { TaxRulesRepo } from '@/domain/tax-rules';
import { FilingStatus } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('TaxRulesRepo', () => {
  let db: SqliteAdapter;
  let repo: TaxRulesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new TaxRulesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForYear returns empty array when no tax rules exist', async () => {
    const result = await repo.listForYear(2026);
    expect(result).toEqual([]);
  });

  it('listForYear returns all tax rules for a given year', async () => {
    // Insert two test fixtures
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        2026,
        'FEDERAL',
        'US',
        'SINGLE',
        JSON.stringify([
          { min: 0, max: 11600, rate: 0.1 },
          { min: 11600, max: null, rate: 0.12 },
        ]),
        14600,
      ]
    );
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        2026,
        'FEDERAL',
        'US',
        'MFJ',
        JSON.stringify([
          { min: 0, max: 23200, rate: 0.1 },
          { min: 23200, max: null, rate: 0.12 },
        ]),
        29200,
      ]
    );

    const result = await repo.listForYear(2026);
    expect(result).toHaveLength(2);
    // Results are ordered by jurisdiction_type, jurisdiction_code, filing_status
    // Both have same jurisdiction, so order by filing_status: 'MFJ' < 'SINGLE'
    expect(result[0].filingStatus).toBe('MFJ');
    expect(result[1].filingStatus).toBe('SINGLE');
  });

  it('lookup returns null when no matching tax rule exists', async () => {
    const result = await repo.lookup(2026, 'FEDERAL', 'US', FilingStatus.SINGLE);
    expect(result).toBeNull();
  });

  it('lookup returns parsed TaxRule when matching row exists', async () => {
    const testBrackets = [
      { min: 0, max: 11600, rate: 0.1 },
      { min: 11600, max: null, rate: 0.12 },
    ];
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [2026, 'FEDERAL', 'US', 'SINGLE', JSON.stringify(testBrackets), 14600]
    );

    const result = await repo.lookup(2026, 'FEDERAL', 'US', FilingStatus.SINGLE);
    expect(result).not.toBeNull();
    expect(result!.year).toBe(2026);
    expect(result!.jurisdictionType).toBe('FEDERAL');
    expect(result!.jurisdictionCode).toBe('US');
    expect(result!.filingStatus).toBe('SINGLE');
    expect(result!.standardDeduction).toBe(14600);
    expect(result!.brackets).toEqual(testBrackets);
  });

  it('lookup returns null when year does not match', async () => {
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        2026,
        'FEDERAL',
        'US',
        'SINGLE',
        JSON.stringify([
          { min: 0, max: 11600, rate: 0.1 },
          { min: 11600, max: null, rate: 0.12 },
        ]),
        14600,
      ]
    );

    const result = await repo.lookup(2025, 'FEDERAL', 'US', FilingStatus.SINGLE);
    expect(result).toBeNull();
  });

  it('lookup correctly parses JSON brackets array', async () => {
    const complexBrackets = [
      { min: 0, max: 10000, rate: 0.05 },
      { min: 10000, max: 25000, rate: 0.1 },
      { min: 25000, max: 50000, rate: 0.15 },
      { min: 50000, max: null, rate: 0.22 },
    ];
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [2026, 'STATE', 'CA', 'SINGLE', JSON.stringify(complexBrackets), 7500]
    );

    const result = await repo.lookup(2026, 'STATE', 'CA', FilingStatus.SINGLE);
    expect(result!.brackets).toHaveLength(4);
    expect(result!.brackets[2].max).toBe(50000);
    expect(result!.brackets[3].rate).toBe(0.22);
  });
});
