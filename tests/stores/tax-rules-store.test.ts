import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const sampleTaxRule = {
  year: 2026,
  jurisdictionType: 'FEDERAL' as const,
  jurisdictionCode: 'US',
  filingStatus: FilingStatus.SINGLE,
  brackets: [
    { min: 0, max: 11600, rate: 0.1 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: null, rate: 0.22 },
  ],
  standardDeduction: 14600,
};

const sampleTaxRuleState = {
  year: 2026,
  jurisdictionType: 'STATE' as const,
  jurisdictionCode: 'CA',
  filingStatus: FilingStatus.MFJ,
  brackets: [
    { min: 0, max: 10000, rate: 0.01 },
    { min: 10000, max: null, rate: 0.09 },
  ],
  standardDeduction: 0,
};

describe('useTaxRulesStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('initial state is empty with no year, no loading, and no error', () => {
    const { year, items, isLoading, error } = useTaxRulesStore.getState();
    expect(year).toBeNull();
    expect(items).toEqual([]);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('loadYear(2026) with 0 rows: items still empty, year set to 2026, no error', async () => {
    await useTaxRulesStore.getState().loadYear(2026);
    const { year, items, isLoading, error } = useTaxRulesStore.getState();
    expect(year).toBe(2026);
    expect(items).toEqual([]);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('loadYear(2026) with 2 inserted rows: items has 2 entries, year set', async () => {
    // Seed directly via DB
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sampleTaxRule.year,
        sampleTaxRule.jurisdictionType,
        sampleTaxRule.jurisdictionCode,
        sampleTaxRule.filingStatus,
        JSON.stringify(sampleTaxRule.brackets),
        sampleTaxRule.standardDeduction,
      ]
    );
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sampleTaxRuleState.year,
        sampleTaxRuleState.jurisdictionType,
        sampleTaxRuleState.jurisdictionCode,
        sampleTaxRuleState.filingStatus,
        JSON.stringify(sampleTaxRuleState.brackets),
        sampleTaxRuleState.standardDeduction,
      ]
    );

    await useTaxRulesStore.getState().loadYear(2026);
    const { year, items, isLoading, error } = useTaxRulesStore.getState();
    expect(year).toBe(2026);
    expect(items).toHaveLength(2);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('second loadYear(2026) call with same year skips re-fetch', async () => {
    // Seed one row
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sampleTaxRule.year,
        sampleTaxRule.jurisdictionType,
        sampleTaxRule.jurisdictionCode,
        sampleTaxRule.filingStatus,
        JSON.stringify(sampleTaxRule.brackets),
        sampleTaxRule.standardDeduction,
      ]
    );

    await useTaxRulesStore.getState().loadYear(2026);
    const stateAfterFirstLoad = useTaxRulesStore.getState();
    expect(stateAfterFirstLoad.items).toHaveLength(1);

    // Now delete the row from the DB (to verify we're not re-fetching)
    await db.execute('DELETE FROM tax_rules');

    // Call loadYear again with the same year
    await useTaxRulesStore.getState().loadYear(2026);
    const stateAfterSecondLoad = useTaxRulesStore.getState();

    // The store should still have the item (not re-fetched from empty DB)
    expect(stateAfterSecondLoad.items).toHaveLength(1);
  });

  it('lookup returns the matching rule', async () => {
    // Seed data
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sampleTaxRule.year,
        sampleTaxRule.jurisdictionType,
        sampleTaxRule.jurisdictionCode,
        sampleTaxRule.filingStatus,
        JSON.stringify(sampleTaxRule.brackets),
        sampleTaxRule.standardDeduction,
      ]
    );

    await useTaxRulesStore.getState().loadYear(2026);
    const result = useTaxRulesStore.getState().lookup('FEDERAL', 'US', FilingStatus.SINGLE);
    expect(result).not.toBeNull();
    expect(result?.jurisdictionType).toBe('FEDERAL');
    expect(result?.jurisdictionCode).toBe('US');
    expect(result?.filingStatus).toBe(FilingStatus.SINGLE);
    expect(result?.standardDeduction).toBe(14600);
  });

  it('lookup with no matching rule returns null', async () => {
    // Seed one rule but search for a different state
    await db.execute(
      `INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sampleTaxRule.year,
        sampleTaxRule.jurisdictionType,
        sampleTaxRule.jurisdictionCode,
        sampleTaxRule.filingStatus,
        JSON.stringify(sampleTaxRule.brackets),
        sampleTaxRule.standardDeduction,
      ]
    );

    await useTaxRulesStore.getState().loadYear(2026);
    const result = useTaxRulesStore.getState().lookup('STATE', 'XX', FilingStatus.SINGLE);
    expect(result).toBeNull();
  });

  it('loadYear() swallows DB errors into state.error (does NOT rethrow)', async () => {
    // Close the underlying DB so subsequent operations fail
    await db.close();

    // loadYear() must not rethrow — it should set error on state
    await expect(useTaxRulesStore.getState().loadYear(2026)).resolves.toBeUndefined();

    const { error, isLoading } = useTaxRulesStore.getState();
    expect(error).not.toBeNull();
    expect(isLoading).toBe(false);
  });
});
