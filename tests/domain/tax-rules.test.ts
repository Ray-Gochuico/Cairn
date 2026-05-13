import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { TaxRulesRepo } from '@/domain/tax-rules';
import { FilingStatus } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadTaxRulesSeed = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0002_seed_tax_rules.sql'), 'utf-8');

describe('TaxRulesRepo', () => {
  let db: SqliteAdapter;
  let repo: TaxRulesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0002_seed_tax_rules', sql: loadTaxRulesSeed() },
    ]);
    repo = new TaxRulesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForYear returns 4 federal + 204 state + 1020 city rules (1228 total) when seed migration applied', async () => {
    const result = await repo.listForYear(2026);
    expect(result).toHaveLength(1228);  // 4 federal + (51 states × 4 filing statuses) + (255 cities × 4 filing statuses)
    expect(result.some(r => r.filingStatus === 'SINGLE')).toBe(true);
    expect(result.some(r => r.filingStatus === 'MFJ')).toBe(true);
  });

  it('listForYear returns all tax rules for a given year', async () => {
    // Insert test fixtures for 2025 (different year from seed year 2026)
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        2025,
        'STATE',
        'CA',
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
        2025,
        'STATE',
        'CA',
        'MFJ',
        JSON.stringify([
          { min: 0, max: 23200, rate: 0.1 },
          { min: 23200, max: null, rate: 0.12 },
        ]),
        29200,
      ]
    );

    const result = await repo.listForYear(2025);
    expect(result).toHaveLength(2);
    // Results are ordered by jurisdiction_type, jurisdiction_code, filing_status
    // Both have same jurisdiction, so order by filing_status: 'MFJ' < 'SINGLE'
    expect(result[0].filingStatus).toBe('MFJ');
    expect(result[1].filingStatus).toBe('SINGLE');
  });

  it('lookup returns null when no matching tax rule exists', async () => {
    const result = await repo.lookup(2025, 'FEDERAL', 'US', FilingStatus.SINGLE);
    expect(result).toBeNull();
  });

  it('lookup returns parsed TaxRule when matching row exists', async () => {
    const testBrackets = [
      { min: 0, max: 11600, rate: 0.1 },
      { min: 11600, max: null, rate: 0.12 },
    ];
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [2025, 'STATE', 'TX', 'SINGLE', JSON.stringify(testBrackets), 14600]
    );

    const result = await repo.lookup(2025, 'STATE', 'TX', FilingStatus.SINGLE);
    expect(result).not.toBeNull();
    expect(result!.year).toBe(2025);
    expect(result!.jurisdictionType).toBe('STATE');
    expect(result!.jurisdictionCode).toBe('TX');
    expect(result!.filingStatus).toBe('SINGLE');
    expect(result!.standardDeduction).toBe(14600);
    expect(result!.brackets).toEqual(testBrackets);
  });

  it('lookup returns null when year does not match', async () => {
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        2025,
        'STATE',
        'NY',
        'SINGLE',
        JSON.stringify([
          { min: 0, max: 11600, rate: 0.1 },
          { min: 11600, max: null, rate: 0.12 },
        ]),
        14600,
      ]
    );

    const result = await repo.lookup(2027, 'STATE', 'NY', FilingStatus.SINGLE);
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
      [2025, 'STATE', 'XX', 'SINGLE', JSON.stringify(complexBrackets), 7500]
    );

    const result = await repo.lookup(2025, 'STATE', 'XX', FilingStatus.SINGLE);
    expect(result!.brackets).toHaveLength(4);
    expect(result!.brackets[2].max).toBe(50000);
    expect(result!.brackets[3].rate).toBe(0.22);
  });
});

describe('0002_seed_tax_rules.sql seed', () => {
  let db: SqliteAdapter;
  let repo: TaxRulesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0002_seed_tax_rules', sql: loadTaxRulesSeed() },
    ]);
    repo = new TaxRulesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('seeds federal 2026 SINGLE brackets', async () => {
    const rule = await repo.lookup(2026, 'FEDERAL', 'US', 'SINGLE');
    expect(rule).not.toBeNull();
    expect(rule!.brackets[0]).toEqual({ min: 0, max: 11600, rate: 0.10 });
    expect(rule!.standardDeduction).toBe(14600);
  });

  it('seeds federal 2026 MFJ brackets', async () => {
    const rule = await repo.lookup(2026, 'FEDERAL', 'US', 'MFJ');
    expect(rule).not.toBeNull();
    expect(rule!.standardDeduction).toBe(29200);
  });

  it('does NOT seed FICA into tax_rules (FICA is constants-only in src/lib/tax.ts)', async () => {
    const rule = await repo.lookup(2026, 'FICA', 'US', 'SINGLE');
    expect(rule).toBeNull();
  });
});

describe('0002 state seed', () => {
  let db: SqliteAdapter;
  let repo: TaxRulesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0002_seed_tax_rules', sql: loadTaxRulesSeed() },
    ]);
    repo = new TaxRulesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('seeds all 50 states + DC for each filing status', async () => {
    const rules = await repo.listForYear(2026);
    const stateRules = rules.filter((r) => r.jurisdictionType === 'STATE');
    expect(stateRules.length).toBe(204);  // 51 jurisdictions × 4 filing statuses
  });

  it('seeds CA progressive brackets — SINGLE starts at 1%', async () => {
    const rule = await repo.lookup(2026, 'STATE', 'CA', 'SINGLE');
    expect(rule).not.toBeNull();
    expect(rule!.brackets[0].rate).toBe(0.01);
    // California has many brackets; just confirm the structure
    expect(rule!.brackets.length).toBeGreaterThan(5);
  });

  it('seeds TX as zero-rate (no wage income tax)', async () => {
    const rule = await repo.lookup(2026, 'STATE', 'TX', 'SINGLE');
    expect(rule!.brackets).toEqual([{ min: 0, max: null, rate: 0 }]);
    expect(rule!.standardDeduction).toBe(0);
  });

  it('seeds NC as flat 3.99%', async () => {
    const rule = await repo.lookup(2026, 'STATE', 'NC', 'SINGLE');
    expect(rule!.brackets[0].rate).toBeCloseTo(0.0399, 4);
  });

  it('Idaho has an explicit 0% zero-tax bracket below $4,811 then 5.3% above', async () => {
    const rule = await repo.lookup(2026, 'STATE', 'ID', 'SINGLE');
    expect(rule!.brackets.length).toBe(2);
    expect(rule!.brackets[0]).toEqual({ min: 0, max: 4811, rate: 0 });
    expect(rule!.brackets[1].rate).toBeCloseTo(0.053, 4);
  });

  it('NY has progressive brackets with the top tier above $25M', async () => {
    const rule = await repo.lookup(2026, 'STATE', 'NY', 'SINGLE');
    expect(rule).not.toBeNull();
    expect(rule!.brackets[rule!.brackets.length - 1].max).toBeNull();
    expect(rule!.brackets.some((b) => b.min === 25000000)).toBe(true);
  });

  it('MFS uses the SINGLE schedule (Phase 3 simplification)', async () => {
    const single = await repo.lookup(2026, 'STATE', 'CA', 'SINGLE');
    const mfs = await repo.lookup(2026, 'STATE', 'CA', 'MFS');
    expect(mfs!.brackets).toEqual(single!.brackets);
    expect(mfs!.standardDeduction).toBe(single!.standardDeduction);
  });

  it('MFJ has its own schedule distinct from SINGLE for progressive states', async () => {
    const single = await repo.lookup(2026, 'STATE', 'CA', 'SINGLE');
    const mfj = await repo.lookup(2026, 'STATE', 'CA', 'MFJ');
    expect(mfj!.brackets).not.toEqual(single!.brackets);
  });
});

describe('0002 city seed', () => {
  let db: SqliteAdapter;
  let repo: TaxRulesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0002_seed_tax_rules', sql: loadTaxRulesSeed() },
    ]);
    repo = new TaxRulesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('seeds NYC with progressive brackets — SINGLE differs from MFJ', async () => {
    const single = await repo.lookup(2026, 'CITY', 'NY_NYC', 'SINGLE');
    const mfj = await repo.lookup(2026, 'CITY', 'NY_NYC', 'MFJ');
    expect(single).not.toBeNull();
    expect(mfj).not.toBeNull();
    expect(single!.brackets[0].rate).toBeCloseTo(0.03078, 5);
    expect(single!.brackets[0].max).toBe(12000);
    expect(mfj!.brackets[0].max).toBe(21600);
    expect(single!.brackets).not.toEqual(mfj!.brackets);
  });

  it('seeds Philadelphia as a flat 3.75% resident wage tax', async () => {
    const rule = await repo.lookup(2026, 'CITY', 'PA_PHILADELPHIA', 'SINGLE');
    expect(rule).not.toBeNull();
    expect(rule!.brackets).toEqual([{ min: 0, max: null, rate: 0.0375 }]);
  });

  it('seeds Detroit at 2.4% flat (resident)', async () => {
    const rule = await repo.lookup(2026, 'CITY', 'MI_DETROIT', 'SINGLE');
    expect(rule!.brackets[0].rate).toBeCloseTo(0.024, 4);
  });

  it('seeds Multnomah County PFA with 0/1.5%/3% tiered brackets (SINGLE)', async () => {
    const rule = await repo.lookup(2026, 'CITY', 'OR_MULTNOMAH_COUNTY', 'SINGLE');
    expect(rule).not.toBeNull();
    expect(rule!.brackets).toEqual([
      { min: 0, max: 125000, rate: 0 },
      { min: 125000, max: 250000, rate: 0.015 },
      { min: 250000, max: null, rate: 0.03 },
    ]);
  });

  it('Multnomah County PFA MFJ tier boundaries differ from SINGLE', async () => {
    const single = await repo.lookup(2026, 'CITY', 'OR_MULTNOMAH_COUNTY', 'SINGLE');
    const mfj = await repo.lookup(2026, 'CITY', 'OR_MULTNOMAH_COUNTY', 'MFJ');
    expect(single!.brackets[1].min).toBe(125000);
    expect(mfj!.brackets[1].min).toBe(200000);
  });

  it('seeds Cleveland and Columbus as flat 2.5%', async () => {
    const cle = await repo.lookup(2026, 'CITY', 'OH_CLEVELAND', 'SINGLE');
    const col = await repo.lookup(2026, 'CITY', 'OH_COLUMBUS', 'SINGLE');
    expect(cle!.brackets[0].rate).toBeCloseTo(0.025, 4);
    expect(col!.brackets[0].rate).toBeCloseTo(0.025, 4);
  });

  it('does NOT seed Yonkers (resident surcharge cannot encode as flat bracket)', async () => {
    expect(await repo.lookup(2026, 'CITY', 'NY_YONKERS', 'SINGLE')).toBeNull();
  });

  it('does NOT seed Denver (Colorado $/month occupational privilege tax)', async () => {
    expect(await repo.lookup(2026, 'CITY', 'CO_DENVER', 'SINGLE')).toBeNull();
  });

  it('seeds 1020 city rows total (255 localities × 4 filing statuses)', async () => {
    const rules = await repo.listForYear(2026);
    const cityRules = rules.filter((r) => r.jurisdictionType === 'CITY');
    expect(cityRules.length).toBe(1020);
  });
});
