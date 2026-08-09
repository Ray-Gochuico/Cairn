import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { saveMaritalFiling, EMPTY_MARITAL_VALUES } from '@/domain/setup-flow/steps/part1';
import { defaultProgressV2 } from '@/lib/setup-progress';
import type { FlowCtx } from '@/domain/setup-flow/types';

/**
 * Smoke finding D1: the married branch appeared not to persist filingStatus.
 * The 6,227-test suite missed it because every flow test stubs the household
 * store — this suite runs the REAL store against the REAL in-memory DB and
 * asserts the PERSISTED row, not the flow's own echo.
 */

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: useHouseholdStore.getState().household,
    persons: [], dependents: [], accounts: [], properties: [], housingPayments: [],
    vehicles: [], vehicleLeases: [], equityGrants: [], loans: [], transactions: [], goals: [],
    progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

describe('saveMaritalFiling against the REAL store + DB (smoke D1)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    await useHouseholdStore.getState().load();
  });

  afterEach(async () => {
    await db.close();
  });

  it('married Yes + Jointly PERSISTS MFJ to the household row', async () => {
    const r = await saveMaritalFiling(
      {
        ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly',
        partnerName: 'Sam Rivera', partnerDob: '1991-02-03',
      },
      ctxWith(),
    );
    expect(r.ok).toBe(true);
    const rows = await db.select<{ filing_status: string }>(
      'SELECT filing_status FROM household WHERE id = 1',
    );
    expect(rows[0].filing_status).toBe('MFJ');
    // And the store's read-back mirrors the row (no store↔DB divergence).
    expect(useHouseholdStore.getState().household?.filingStatus).toBe('MFJ');
  });

  it('a later 1c-style read-merge update PRESERVES the married status', async () => {
    await saveMaritalFiling(
      { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly' },
      ctxWith(),
    );
    // The 1c/1e writes are partial patches over a read-merge-write repo —
    // they must never clobber filing_status back to the seeded SINGLE.
    await useHouseholdStore.getState().update({ state: 'NY', city: null });
    await useHouseholdStore.getState().update({ monthlyExpenseBaseline: 6000 });
    const rows = await db.select<{ filing_status: string; state: string; monthly_expense_baseline: number }>(
      'SELECT filing_status, state, monthly_expense_baseline FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({
      filing_status: 'MFJ', state: 'NY', monthly_expense_baseline: 6000,
    });
  });
});
