import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import type { GrowthScenario } from '@/types/schema';
import {
  SCENARIO_FIELDS,
  buildScenarioDefaults,
  readOverridesFor,
  scenarioStorageKeyFor,
  toEngineAssumptions,
  writeOverridesFor,
  type EngineAssumptions,
  type ScenarioAssumptions,
  type ScenarioField,
  type ScopeExclusions,
} from './scenario-assumptions';
import { getCalcScopePersonId, subscribeCalcScope } from './calc-view-scope';
import { usePersonsStore } from '@/stores/persons-store';

/**
 * React binding for the Wave-16 shared scenario (Basecamp spine). One
 * module-level external store so the ScenarioBar and every consumer card see
 * the SAME overrides object — sessionStorage alone cannot re-render siblings.
 *
 * Defaults are recomputed from the stores on every store change (the same
 * contract each card's `defaults` useMemo had), so hydration keeps working:
 * un-edited fields track the user's real data live; edited fields win.
 *
 * Does NOT call any store load() — the shared-store-gate boot-loop gotcha:
 * pages own hydration (CalculatorsLayout loads all nine stores; Backtest
 * loads its two). Debounce lives at the input boundary in ScenarioBar (D5);
 * setField here is synchronous.
 */

const listeners = new Set<() => void>();

// Wave B (D-B11): one cached snapshot per silo key so useSyncExternalStore
// gets a stable reference per scope. The household entry keeps flowing
// through readSharedOverrides (its migration contract untouched).
const overridesCacheByKey = new Map<string, Partial<ScenarioAssumptions>>();

function getOverridesSnapshotFor(scopePersonId: number | null): Partial<ScenarioAssumptions> {
  const key = scenarioStorageKeyFor(scopePersonId);
  let cached = overridesCacheByKey.get(key);
  if (cached === undefined) {
    cached = readOverridesFor(scopePersonId);
    overridesCacheByKey.set(key, cached);
  }
  return cached;
}

function commitOverridesFor(scopePersonId: number | null, next: Partial<ScenarioAssumptions>): void {
  overridesCacheByKey.set(scenarioStorageKeyFor(scopePersonId), next);
  writeOverridesFor(scopePersonId, next);
  listeners.forEach((l) => l());
}

/**
 * Wave B gate fix: the ONE live-scope resolution point for WRITES — the same
 * degradation the display uses (a mirrored id whose person no longer exists
 * degrades to household). Pre-fix, setField read the raw mirror and could
 * write an orphan calc-scenario:p{id} silo while the UI showed household.
 */
function resolveActiveScopeId(): number | null {
  const id = getCalcScopePersonId();
  if (id == null) return null;
  return usePersonsStore.getState().persons.some((p) => p.id === id) ? id : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Wave 18 (D7 layer): per-person salary overrides ─────────────────────────
// Scenario-layer ONLY (owner constraint 5): these ride the same external
// store + sessionStorage tier as the six shared fields — the persons store is
// NEVER written. Separate key so scenario-assumptions.ts's sanitize/migration
// contract for the flat numeric shape stays untouched.
const SALARY_KEY = 'calc-scenario:salaries';

function readSalaries(): Record<number, number> {
  try {
    const raw = sessionStorage.getItem(SALARY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(k);
      if (Number.isInteger(id) && id > 0 && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[id] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

let cachedSalaries: Record<number, number> | null = null;

function getSalariesSnapshot(): Record<number, number> {
  if (cachedSalaries === null) cachedSalaries = readSalaries();
  return cachedSalaries;
}

function commitSalaries(next: Record<number, number>): void {
  cachedSalaries = next;
  try {
    if (Object.keys(next).length === 0) sessionStorage.removeItem(SALARY_KEY);
    else sessionStorage.setItem(SALARY_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage unavailable — in-memory state still drives the UI.
  }
  listeners.forEach((l) => l());
}

/** Live per-person salary overrides — the D7 ripple's one read point
 *  (useHouseholdTaxContext consumes this INTERNALLY). */
export function useSalaryOverrides(): Record<number, number> {
  return useSyncExternalStore(subscribe, getSalariesSnapshot);
}

/** Test-only: drop the module cache + listeners between tests. */
export function __resetScenarioAssumptionsForTests(): void {
  overridesCacheByKey.clear();
  cachedSalaries = null;
  listeners.clear();
}

export interface UseScenarioAssumptionsResult {
  values: ScenarioAssumptions;
  /** The store-derived prefills (un-overridden) — the D6 delta base. */
  defaults: ScenarioAssumptions;
  engine: EngineAssumptions;
  provenance: Record<ScenarioField, string>;
  isEdited: Record<ScenarioField, boolean>;
  /** editedCount includes per-person salary overrides (Wave 18 D7). */
  editedCount: number;
  scenarioList: GrowthScenario[];
  /** Wave 18 (D7): per-person annual-salary overrides — scenario-layer only. */
  salaryByPersonId: Record<number, number>;
  setSalary: (personId: number, value: number | null) => void;
  setField: (field: ScenarioField, value: number) => void;
  resetField: (field: ScenarioField) => void;
  resetAll: () => void;
  /** Wave B: the active page scope (null = household; stale ids degrade). */
  scopePersonId: number | null;
  scopePersonName: string | null;
  /** Wave B (D-B1/D-B4): what the person scope excluded; null in household. */
  scopeExclusions: ScopeExclusions | null;
}

export function useScenarioAssumptions(): UseScenarioAssumptionsResult {
  const household = useHouseholdStore((s) => s.household);
  const settings = useSettingsStore((s) => s.settings);
  const accounts = useAccountsStore((s) => s.accounts);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const contributions = useContributionsStore((s) => s.contributions);

  // Wave B (D-B10/D-B11): the mirrored page scope selects the active silo +
  // the scoped defaults. A stale mirrored id (deleted person, store reset)
  // degrades to household.
  const mirroredScopeId = useSyncExternalStore(subscribeCalcScope, getCalcScopePersonId);
  const realPersons = usePersonsStore((s) => s.persons);
  const scopePerson =
    mirroredScopeId != null ? (realPersons.find((p) => p.id === mirroredScopeId) ?? null) : null;
  const effectiveScopeId = scopePerson?.id ?? null;

  const overrides = useSyncExternalStore(subscribe, () => getOverridesSnapshotFor(effectiveScopeId));
  const salaryByPersonId = useSyncExternalStore(subscribe, getSalariesSnapshot);

  const { defaults, provenance, scopeExclusions } = useMemo(
    () =>
      buildScenarioDefaults({
        household, settings, accounts, snapshots, contributions,
        scope:
          scopePerson?.id != null
            ? {
                personId: scopePerson.id,
                personName: scopePerson.name,
                // 0051: the durable per-person expense figure rides the scope.
                monthlyExpenseBaseline: scopePerson.monthlyExpenseBaseline,
              }
            : null,
      }),
    [household, settings, accounts, snapshots, contributions, scopePerson],
  );

  const values = useMemo<ScenarioAssumptions>(
    () => ({ ...defaults, ...overrides }),
    [defaults, overrides],
  );
  const engine = useMemo(() => toEngineAssumptions(values), [values]);

  const isEdited = useMemo(() => {
    const out = {} as Record<ScenarioField, boolean>;
    for (const f of SCENARIO_FIELDS) out[f] = f in overrides;
    return out;
  }, [overrides]);
  // D-B11: in person scope only the scoped person's salary field is visible —
  // editedCount counts only what the bar renders.
  const visibleSalaryEdits = useMemo(() => {
    if (effectiveScopeId == null) return Object.keys(salaryByPersonId).length;
    return salaryByPersonId[effectiveScopeId] != null ? 1 : 0;
  }, [salaryByPersonId, effectiveScopeId]);
  const editedCount = useMemo(
    () => Object.keys(overrides).length + visibleSalaryEdits,
    [overrides, visibleSalaryEdits],
  );

  // D3: a custom return collapses the projection tables to one honest row.
  const scenarioList = useMemo<GrowthScenario[]>(
    () =>
      isEdited.returnPct
        ? [{ label: 'Custom', rate: engine.returnRate }]
        : household?.growthScenarios ?? [],
    [isEdited.returnPct, engine.returnRate, household],
  );

  // setField/resetField read the LIVE mirror at call time (closure-free, the
  // same pattern the shared-silo version used) so a scope flip mid-session
  // routes the very next edit into the newly-active silo.
  const setField = useCallback((field: ScenarioField, value: number) => {
    const scopeId = resolveActiveScopeId();
    commitOverridesFor(scopeId, { ...getOverridesSnapshotFor(scopeId), [field]: value });
  }, []);

  const resetField = useCallback((field: ScenarioField) => {
    const scopeId = resolveActiveScopeId();
    const next = { ...getOverridesSnapshotFor(scopeId) };
    delete next[field];
    commitOverridesFor(scopeId, next);
  }, []);

  const setSalary = useCallback((personId: number, value: number | null) => {
    const next = { ...getSalariesSnapshot() };
    if (value == null) delete next[personId];
    else next[personId] = Math.max(0, value);
    commitSalaries(next);
  }, []);

  // D-B11: the scoped variant clears only the ACTIVE silo and only the scoped
  // person's salary override — the other person's edits survive.
  const resetAll = useCallback(() => {
    const scopeId = resolveActiveScopeId();
    commitOverridesFor(scopeId, {});
    if (scopeId == null) {
      commitSalaries({});
    } else {
      const next = { ...getSalariesSnapshot() };
      delete next[scopeId];
      commitSalaries(next);
    }
  }, []);

  return {
    values, defaults, engine, provenance, isEdited, editedCount, scenarioList,
    salaryByPersonId, setSalary,
    setField, resetField, resetAll,
    scopePersonId: effectiveScopeId,
    scopePersonName: scopePerson?.name ?? null,
    scopeExclusions,
  };
}
