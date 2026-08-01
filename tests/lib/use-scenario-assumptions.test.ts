import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useScenarioAssumptions,
  __resetScenarioAssumptionsForTests,
} from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { makePerson, makeAccount } from '../factories';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

function mkHousehold(): Household {
  return {
    filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
    monthlyExpenseBaseline: 5000, withdrawalRate: 0.04, inflationAssumption: 0.03,
    growthScenarios: [
      { label: 'Conservative', rate: 0.05 },
      { label: 'Moderate', rate: 0.06 },
      { label: 'Optimistic', rate: 0.07 },
    ],
  } as Household;
}

beforeEach(() => {
  sessionStorage.clear();
  __resetScenarioAssumptionsForTests();
  __resetCalcScopeForTests();
  useHouseholdStore.setState({ household: mkHousehold(), isLoading: false, error: null });
  useSettingsStore.setState({ settings: null, isLoading: false, error: null } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    isLoading: false,
    error: null,
  } as never);
});

describe('useScenarioAssumptions', () => {
  it('starts from store-derived defaults, nothing edited', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.values.monthlyExpenses).toBe(5000);
    expect(result.current.values.swrPct).toBe(4);
    expect(result.current.values.returnPct).toBe(6);
    expect(result.current.editedCount).toBe(0);
    expect(result.current.isEdited.portfolio).toBe(false);
  });

  it('setField commits synchronously, persists, and flags the field', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => result.current.setField('monthlyExpenses', 6500));
    expect(result.current.values.monthlyExpenses).toBe(6500);
    expect(result.current.isEdited.monthlyExpenses).toBe(true);
    expect(result.current.editedCount).toBe(1);
    expect(JSON.parse(sessionStorage.getItem(SCENARIO_STORAGE_KEY)!)).toEqual({ monthlyExpenses: 6500 });
  });

  it('two hook instances share one state (bar + card see the same edit)', () => {
    const { result } = renderHook(() => ({
      bar: useScenarioAssumptions(),
      card: useScenarioAssumptions(),
    }));
    act(() => result.current.bar.setField('portfolio', 750_000));
    expect(result.current.card.values.portfolio).toBe(750_000);
    expect(result.current.card.engine.portfolio).toBe(750_000);
  });

  it('engine is the boundary output (no per-consumer conversion)', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => result.current.setField('swrPct', 3.5));
    expect(result.current.engine.swr).toBeCloseTo(0.035, 12);
    expect(result.current.engine.annualExpenses).toBe(60_000);
    expect(result.current.engine.monthlyContribution).toBe(0);
  });

  it('resetField clears one override; resetAll clears everything and the key', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => {
      result.current.setField('portfolio', 1);
      result.current.setField('swrPct', 5);
    });
    act(() => result.current.resetField('portfolio'));
    expect(result.current.isEdited.portfolio).toBe(false);
    expect(result.current.isEdited.swrPct).toBe(true);
    act(() => result.current.resetAll());
    expect(result.current.editedCount).toBe(0);
    expect(result.current.values.swrPct).toBe(4);
    expect(sessionStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
  });

  it('D3: scenarioList is the household list until returnPct is edited, then a single Custom row', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.scenarioList.map((s) => s.label)).toEqual([
      'Conservative', 'Moderate', 'Optimistic',
    ]);
    act(() => result.current.setField('returnPct', 9));
    expect(result.current.scenarioList).toEqual([{ label: 'Custom', rate: 0.09 }]);
    act(() => result.current.resetField('returnPct'));
    expect(result.current.scenarioList).toHaveLength(3);
  });

  it('rehydrates persisted overrides over fresh defaults (same contract as useCalculatorState)', () => {
    sessionStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ swrPct: 3.2 }));
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.values.swrPct).toBe(3.2);
    expect(result.current.values.monthlyExpenses).toBe(5000); // default still live
    expect(result.current.editedCount).toBe(1);
  });
});

describe('salary overrides (Wave 18 D7 layer)', () => {
  it('setSalary persists under calc-scenario:salaries and joins the edited semantics', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.salaryByPersonId).toEqual({});
    act(() => result.current.setSalary(1, 120_000));
    expect(result.current.salaryByPersonId).toEqual({ 1: 120_000 });
    expect(result.current.editedCount).toBe(1);
    expect(JSON.parse(sessionStorage.getItem('calc-scenario:salaries')!)).toEqual({ '1': 120_000 });
  });

  it('setSalary(id, null) clears one person; resetAll clears salaries too', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => {
      result.current.setSalary(1, 120_000);
      result.current.setSalary(2, 90_000);
    });
    expect(result.current.editedCount).toBe(2);
    act(() => result.current.setSalary(1, null));
    expect(result.current.salaryByPersonId).toEqual({ 2: 90_000 });
    act(() => result.current.resetAll());
    expect(result.current.salaryByPersonId).toEqual({});
    expect(result.current.editedCount).toBe(0);
    expect(sessionStorage.getItem('calc-scenario:salaries')).toBeNull();
  });

  it('two hook instances share the salary state live', () => {
    const { result } = renderHook(() => ({
      bar: useScenarioAssumptions(),
      card: useScenarioAssumptions(),
    }));
    act(() => result.current.bar.setSalary(1, 111_000));
    expect(result.current.card.salaryByPersonId).toEqual({ 1: 111_000 });
  });
});

describe('Wave B: scope-aware bar state', () => {
  // Same fixture shape as the scoped buildScenarioDefaults suite: p1 owns
  // account 1 ($100k), p2 owns account 2 ($40k), account 3 joint ($8k);
  // contributions $1,200 for p2, $600 unattributed, $500 for p1.
  beforeEach(() => {
    useAccountsStore.setState({
      accounts: [
        makeAccount({ id: 1, ownerPersonId: 1 }),
        makeAccount({ id: 2, ownerPersonId: 2 }),
        makeAccount({ id: 3, ownerPersonId: null }),
      ],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [
        { accountId: 1, snapshotDate: '2026-07-01', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2026-07-01', totalValue: 40_000 },
        { accountId: 3, snapshotDate: '2026-07-01', totalValue: 8_000 },
      ],
      isLoading: false,
      error: null,
    } as never);
    useContributionsStore.setState({
      contributions: [
        { accountId: 2, date: '2026-06-15', amount: 1_200, personId: 2 },
        { accountId: 3, date: '2026-06-20', amount: 600, personId: null },
        { accountId: 1, date: '2026-06-25', amount: 500, personId: 1 },
      ],
      isLoading: false,
      error: null,
    } as never);
  });

  it('person scope resolves scoped defaults and a sibling silo; household silo is untouched', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => result.current.setField('portfolio', 111)); // household edit
    act(() => syncCalcScope(2));
    expect(result.current.values.portfolio).toBe(40000);      // Bob's scoped default (no override)
    expect(result.current.editedCount).toBe(0);               // scope flip alone edits NOTHING (constraint 1)
    act(() => result.current.setField('portfolio', 222));
    expect(JSON.parse(sessionStorage.getItem('calc-scenario:p2')!)).toEqual({ portfolio: 222 });
    expect(JSON.parse(sessionStorage.getItem('calc-scenario:shared')!)).toEqual({ portfolio: 111 });
    act(() => syncCalcScope(null));
    expect(result.current.values.portfolio).toBe(111);        // the household override is still there
  });

  it('D-B11: editedCount counts only the VISIBLE salary override; scoped resetAll spares the other person', () => {
    const { result } = renderHook(() => useScenarioAssumptions());
    act(() => result.current.setSalary(1, 90000));
    act(() => result.current.setSalary(2, 80000));
    act(() => syncCalcScope(2));
    expect(result.current.editedCount).toBe(1); // only Bob's salary is visible in Bob's scope
    act(() => result.current.resetAll());
    expect(result.current.salaryByPersonId[1]).toBe(90000); // Alice's override survives
    expect(result.current.salaryByPersonId[2]).toBeUndefined();
  });

  it('Wave B gate fix: a stale mirrored id degrades WRITES to household too — no orphan silo', () => {
    act(() => syncCalcScope(99)); // person 99 does not exist
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.scopePersonId).toBeNull(); // display degrades…
    act(() => result.current.setField('portfolio', 123));
    // …and the write follows the SAME degraded resolution:
    expect(sessionStorage.getItem('calc-scenario:p99')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('calc-scenario:shared')!)).toEqual({ portfolio: 123 });
    expect(result.current.values.portfolio).toBe(123);
    act(() => result.current.resetAll());
    expect(sessionStorage.getItem('calc-scenario:shared')).toBeNull();
  });

  it('exposes the scope + exclusions for the cards', () => {
    act(() => syncCalcScope(2));
    const { result } = renderHook(() => useScenarioAssumptions());
    expect(result.current.scopePersonId).toBe(2);
    expect(result.current.scopePersonName).toBe('Bob');
    expect(result.current.scopeExclusions).toEqual({ jointPortfolio: 8000, unattributedContribution: 600 });
  });
});
