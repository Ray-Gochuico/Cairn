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

/** Test-only: drop the module cache + listeners between tests. */
export function __resetScenarioAssumptionsForTests(): void {
  cachedOverrides = null;
  listeners.clear();
}

export interface UseScenarioAssumptionsResult {
  values: ScenarioAssumptions;
  engine: EngineAssumptions;
  provenance: Record<ScenarioField, string>;
  isEdited: Record<ScenarioField, boolean>;
  editedCount: number;
  scenarioList: GrowthScenario[];
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
  const editedCount = useMemo(() => Object.keys(overrides).length, [overrides]);

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

  const resetAll = useCallback(() => commitOverrides({}), []);

  return {
    values, engine, provenance, isEdited, editedCount, scenarioList,
    setField, resetField, resetAll,
  };
}
