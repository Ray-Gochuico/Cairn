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
  readSharedOverrides,
  toEngineAssumptions,
  writeSharedOverrides,
  type EngineAssumptions,
  type ScenarioAssumptions,
  type ScenarioField,
} from './scenario-assumptions';

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

let cachedOverrides: Partial<ScenarioAssumptions> | null = null;
const listeners = new Set<() => void>();

function getOverridesSnapshot(): Partial<ScenarioAssumptions> {
  if (cachedOverrides === null) cachedOverrides = readSharedOverrides();
  return cachedOverrides;
}

function commitOverrides(next: Partial<ScenarioAssumptions>): void {
  cachedOverrides = next;
  writeSharedOverrides(next);
  listeners.forEach((l) => l());
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
  cachedOverrides = null;
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
}

export function useScenarioAssumptions(): UseScenarioAssumptionsResult {
  const household = useHouseholdStore((s) => s.household);
  const settings = useSettingsStore((s) => s.settings);
  const accounts = useAccountsStore((s) => s.accounts);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const contributions = useContributionsStore((s) => s.contributions);

  const overrides = useSyncExternalStore(subscribe, getOverridesSnapshot);
  const salaryByPersonId = useSyncExternalStore(subscribe, getSalariesSnapshot);

  const { defaults, provenance } = useMemo(
    () => buildScenarioDefaults({ household, settings, accounts, snapshots, contributions }),
    [household, settings, accounts, snapshots, contributions],
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
  const editedCount = useMemo(
    () => Object.keys(overrides).length + Object.keys(salaryByPersonId).length,
    [overrides, salaryByPersonId],
  );

  // D3: a custom return collapses the projection tables to one honest row.
  const scenarioList = useMemo<GrowthScenario[]>(
    () =>
      isEdited.returnPct
        ? [{ label: 'Custom', rate: engine.returnRate }]
        : household?.growthScenarios ?? [],
    [isEdited.returnPct, engine.returnRate, household],
  );

  const setField = useCallback((field: ScenarioField, value: number) => {
    commitOverrides({ ...getOverridesSnapshot(), [field]: value });
  }, []);

  const resetField = useCallback((field: ScenarioField) => {
    const next = { ...getOverridesSnapshot() };
    delete next[field];
    commitOverrides(next);
  }, []);

  const setSalary = useCallback((personId: number, value: number | null) => {
    const next = { ...getSalariesSnapshot() };
    if (value == null) delete next[personId];
    else next[personId] = Math.max(0, value);
    commitSalaries(next);
  }, []);

  const resetAll = useCallback(() => {
    commitOverrides({});
    commitSalaries({});
  }, []);

  return {
    values, defaults, engine, provenance, isEdited, editedCount, scenarioList,
    salaryByPersonId, setSalary,
    setField, resetField, resetAll,
  };
}
