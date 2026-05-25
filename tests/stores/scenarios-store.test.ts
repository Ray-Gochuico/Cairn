import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useScenariosStore, _resetProjectionCacheForTest } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';

const resetStore = () => {
  _resetProjectionCacheForTest();
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
  });
};

describe('useScenariosStore — load + baseline auto-creation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStore();
  });

  afterEach(async () => { await db.close(); });

  it('initial in-memory state has the documented defaults', () => {
    const s = useScenariosStore.getState();
    expect(s.scenarios).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.horizonMonths).toBe(360);
    expect(s.dollarMode).toBe('nominal');
    expect(s.inflation).toBeCloseTo(0.025, 4);
    expect(s.defaultReturnRate).toBeCloseTo(0.07, 4);
  });

  it('load() against an empty table auto-creates a baseline scenario', async () => {
    await useScenariosStore.getState().load();
    const { scenarios, error } = useScenariosStore.getState();
    expect(error).toBeNull();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].isBaseline).toBe(true);
    expect(scenarios[0].isActive).toBe(true);
    expect(scenarios[0].name).toBe('Baseline');
    expect(scenarios[0].color).toBe('#4f86f7');
    expect(scenarios[0].leverPayload).toEqual(emptyLeverPayload());
  });

  it('load() against a populated table does NOT create a second baseline', async () => {
    await useScenariosStore.getState().load();
    await useScenariosStore.getState().load();
    const { scenarios } = useScenariosStore.getState();
    expect(scenarios.filter((s) => s.isBaseline)).toHaveLength(1);
  });

  it('load() writes DB errors into state.error and does not throw', async () => {
    await db.close();
    await useScenariosStore.getState().load();
    expect(useScenariosStore.getState().error).toBeTruthy();
    expect(useScenariosStore.getState().scenarios).toEqual([]);
  });
});

import type { Scenario } from '@/types/scenario';

const variantInput = (over: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>> = {}) => ({
  name: 'Variant',
  isBaseline: false,
  color: '#a8c0fb',
  lineStyle: 'solid' as const,
  visible: true,
  isActive: false,
  sortOrder: 1,
  leverPayload: emptyLeverPayload(),
  ...over,
});

describe('useScenariosStore — mutators', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStore();
    await useScenariosStore.getState().load();
  });

  afterEach(async () => { await db.close(); });

  it('create() inserts a new scenario and refreshes the cache', async () => {
    const id = await useScenariosStore.getState().create(variantInput({ name: 'Pay-off Auto' }));
    expect(id).toBeGreaterThan(0);
    const list = useScenariosStore.getState().scenarios;
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.id === id)?.name).toBe('Pay-off Auto');
  });

  it('create() rethrows on validation failure', async () => {
    await expect(
      useScenariosStore.getState().create(variantInput({ color: 'reddish' })),
    ).rejects.toThrow();
  });

  it('update() persists a patch and refreshes', async () => {
    const id = await useScenariosStore.getState().create(variantInput());
    await useScenariosStore.getState().update(id, { name: 'Renamed' });
    const list = useScenariosStore.getState().scenarios;
    expect(list.find((s) => s.id === id)?.name).toBe('Renamed');
  });

  it('remove() removes a non-baseline scenario', async () => {
    const id = await useScenariosStore.getState().create(variantInput());
    await useScenariosStore.getState().remove(id);
    expect(useScenariosStore.getState().scenarios.find((s) => s.id === id)).toBeUndefined();
  });

  it('remove() rejects on the baseline scenario', async () => {
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    await expect(useScenariosStore.getState().remove(baselineId)).rejects.toThrow(/cannot delete baseline/i);
  });

  it('setActive() flips the active flag and refreshes', async () => {
    const id = await useScenariosStore.getState().create(variantInput());
    await useScenariosStore.getState().setActive(id);
    const list = useScenariosStore.getState().scenarios;
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([id]);
  });

  it('updateLever() merges a partial LeverPayload (other slices preserved)', async () => {
    const id = await useScenariosStore.getState().create(variantInput({
      leverPayload: { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 5000, destination: 'cash' }] },
    }));
    await useScenariosStore.getState().updateLever(id, { extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }] });
    const after = useScenariosStore.getState().scenarios.find((s) => s.id === id)!;
    expect(after.leverPayload.extraLoanPayments).toEqual([{ loanId: 1, extraMonthly: 300 }]);
    expect(after.leverPayload.lumpSums).toHaveLength(1);
  });

  it('duplicate() creates a copy with " (copy)" suffix and sortOrder = source + 1', async () => {
    const id = await useScenariosStore.getState().create(variantInput({ name: 'Aggressive', sortOrder: 3 }));
    const copyId = await useScenariosStore.getState().duplicate(id);
    const copy = useScenariosStore.getState().scenarios.find((s) => s.id === copyId)!;
    expect(copy.name).toBe('Aggressive (copy)');
    expect(copy.isBaseline).toBe(false);
    expect(copy.isActive).toBe(false);
    expect(copy.sortOrder).toBe(4);
  });

  it('duplicate() supports an explicit new name', async () => {
    const id = await useScenariosStore.getState().create(variantInput({ name: 'A' }));
    const copyId = await useScenariosStore.getState().duplicate(id, 'A — variant');
    expect(useScenariosStore.getState().scenarios.find((s) => s.id === copyId)?.name).toBe('A — variant');
  });

  it('rename() updates only the name', async () => {
    const id = await useScenariosStore.getState().create(variantInput());
    await useScenariosStore.getState().rename(id, 'New name');
    expect(useScenariosStore.getState().scenarios.find((s) => s.id === id)?.name).toBe('New name');
  });
});

describe('useScenariosStore — UI-state mutators', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStore();
    await useScenariosStore.getState().load();
  });

  afterEach(async () => { await db.close(); });

  it('setHorizonMonths clamps to [60, 480]', () => {
    useScenariosStore.getState().setHorizonMonths(50);
    expect(useScenariosStore.getState().horizonMonths).toBe(60);
    useScenariosStore.getState().setHorizonMonths(500);
    expect(useScenariosStore.getState().horizonMonths).toBe(480);
    useScenariosStore.getState().setHorizonMonths(240);
    expect(useScenariosStore.getState().horizonMonths).toBe(240);
  });

  it('setDollarMode flips between nominal and real', () => {
    expect(useScenariosStore.getState().dollarMode).toBe('nominal');
    useScenariosStore.getState().setDollarMode('real');
    expect(useScenariosStore.getState().dollarMode).toBe('real');
  });

  it('toggleVisibility persists the visible flag through the DB', async () => {
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    expect(useScenariosStore.getState().scenarios.find((s) => s.id === baselineId)?.visible).toBe(true);
    await useScenariosStore.getState().toggleVisibility(baselineId);
    expect(useScenariosStore.getState().scenarios.find((s) => s.id === baselineId)?.visible).toBe(false);

    const { ScenariosRepo } = await import('@/domain/scenarios');
    const repo = new ScenariosRepo(db);
    const reloaded = await repo.findById(baselineId);
    expect(reloaded?.visible).toBe(false);
  });
});

import type { RealState } from '@/lib/scenarios';

const sampleRealState = (): RealState => ({
  accounts: [],
  holdings: [{ id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null } as any],
  loans: [{ id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60 } as any],
  loanPayments: [],
  household: {
    id: 1,
    filingStatus: 'SINGLE', state: 'CA', city: null,
  } as any,
  persons: [{ id: 1, annualSalaryPretax: 135000 } as any],
  baselineMonthlyExpenses: 4500,
  initialCash: 0,
  initialInvestments: 200000,
  defaults: { inflation: 0.025, returnRate: 0.07 },
  startISO: '2026-05',
  taxBrackets: { federal: [], state: [], city: null, standardDeduction: 0 },
});

describe('useScenariosStore.projectedScenarios — memoization', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStore();
    await useScenariosStore.getState().load();
  });

  afterEach(async () => { await db.close(); });

  it('returns a projection per visible scenario keyed by scenario id', () => {
    const result = useScenariosStore.getState().projectedScenarios(sampleRealState());
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    expect(result.has(baselineId)).toBe(true);
    expect(result.get(baselineId)!.length).toBe(360);
  });

  it('caches projections — a second call with the same inputs returns identical references', () => {
    const real = sampleRealState();
    const a = useScenariosStore.getState().projectedScenarios(real);
    const b = useScenariosStore.getState().projectedScenarios(real);
    for (const [id, states] of a) {
      expect(b.get(id)).toBe(states);
    }
  });

  it('skips invisible scenarios entirely', async () => {
    const id = await useScenariosStore.getState().create(variantInput({ visible: false }));
    const result = useScenariosStore.getState().projectedScenarios(sampleRealState());
    expect(result.has(id)).toBe(false);
  });

  it('updateLever invalidates the cache for the affected scenario', async () => {
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    const real = sampleRealState();
    const before = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    await useScenariosStore.getState().updateLever(baselineId, { extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }] });
    const after = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    expect(after).not.toBe(before);
    const beforeDebtFree = before.findIndex((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    const afterDebtFree  = after.findIndex((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(afterDebtFree).toBeLessThan(beforeDebtFree);
  });

  it('saveCurrentAsScenario snapshots the active scenarios lever payload as a new row', async () => {
    const store = useScenariosStore.getState();
    const baseline = store.scenarios.find((s) => s.isBaseline)!;
    await store.updateLever(baseline.id!, {
      extraLoanPayments: [{ loanId: 9, extraMonthly: 250 }],
    });
    const newId = await useScenariosStore.getState().saveCurrentAsScenario('Snapshot A');
    expect(newId).toBeGreaterThan(0);
    const { scenarios } = useScenariosStore.getState();
    const snap = scenarios.find((s) => s.id === newId)!;
    expect(snap.name).toBe('Snapshot A');
    expect(snap.isBaseline).toBe(false);
    expect(snap.isActive).toBe(false);
    expect(snap.visible).toBe(true);
    expect(snap.leverPayload.extraLoanPayments).toEqual([{ loanId: 9, extraMonthly: 250 }]);
    expect(snap.sortOrder).toBeGreaterThan(baseline.sortOrder);
  });

  it('setHorizonMonths invalidates the entire cache', () => {
    const real = sampleRealState();
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    const before = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    useScenariosStore.getState().setHorizonMonths(120);
    const after = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    expect(after).not.toBe(before);
    expect(after.length).toBe(120);
  });

  it('dollar-mode toggle does NOT re-project — toReal is applied at the chart layer', () => {
    const real = sampleRealState();
    const baselineId = useScenariosStore.getState().scenarios.find((s) => s.isBaseline)!.id!;
    const nominal = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    useScenariosStore.getState().setDollarMode('real');
    const stillNominal = useScenariosStore.getState().projectedScenarios(real).get(baselineId)!;
    expect(stillNominal).toBe(nominal);
  });
});
