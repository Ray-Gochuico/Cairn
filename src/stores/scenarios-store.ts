import { create } from 'zustand';
import { ScenariosRepo } from '@/domain/scenarios';
import { getDatabase } from '@/db/db';
import {
  emptyLeverPayload,
  projectScenario,
  type LeverPayload,
  type MonthlyState,
  type RealState,
} from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

export type DollarMode = 'nominal' | 'real';

interface ProjectionCacheEntry {
  states: MonthlyState[];
  key: string;
}

// Module-level projection cache. Lives outside the Zustand store so that
// reading it during render (from `projectedScenarios`) never triggers a
// store update, which would otherwise schedule re-renders on subscribed
// components mid-render and produce a "Cannot update X while rendering Y"
// React error.
const projectionCache = new Map<number, ProjectionCacheEntry>();

export function _resetProjectionCacheForTest(): void {
  projectionCache.clear();
}

interface ScenariosState {
  scenarios: Scenario[];
  isLoading: boolean;
  error: string | null;

  horizonMonths: number;
  dollarMode: DollarMode;
  inflation: number;
  defaultReturnRate: number;

  load: () => Promise<void>;
  create: (input: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setActive: (id: number) => Promise<void>;
  updateLever: (id: number, partial: Partial<LeverPayload>) => Promise<void>;
  duplicate: (sourceId: number, newName?: string) => Promise<number>;
  rename: (id: number, newName: string) => Promise<void>;
  toggleVisibility: (id: number) => Promise<void>;
  saveCurrentAsScenario: (newName: string) => Promise<number>;
  setHorizonMonths: (months: number) => void;
  setDollarMode: (mode: DollarMode) => void;

  activeScenario: () => Scenario | undefined;
  visibleScenarioIds: () => number[];

  projectedScenarios: (real: RealState) => Map<number, MonthlyState[]>;
}

const BASELINE_DEFAULTS: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Baseline',
  isBaseline: true,
  color: '#4f86f7',
  lineStyle: 'solid',
  visible: true,
  isActive: true,
  sortOrder: 0,
  leverPayload: emptyLeverPayload(),
};

export const useScenariosStore = create<ScenariosState>((set, get) => ({
  scenarios: [],
  isLoading: false,
  error: null,
  horizonMonths: 360,
  dollarMode: 'nominal',
  inflation: 0.025,
  defaultReturnRate: 0.07,

  activeScenario: () => {
    const ss = get().scenarios;
    return ss.find((s) => s.isActive) ?? ss.find((s) => s.isBaseline);
  },

  visibleScenarioIds: () =>
    get()
      .scenarios.filter((s) => s.visible && s.id != null)
      .map((s) => s.id as number),

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new ScenariosRepo(getDatabase());
      let scenarios = await repo.list();
      if (scenarios.length === 0) {
        await repo.create(BASELINE_DEFAULTS);
        scenarios = await repo.list();
      }
      set({ scenarios, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load scenarios' });
    }
  },

  create: async (input) => {
    const repo = new ScenariosRepo(getDatabase());
    const id = await repo.create(input);
    invalidateProjectionFor(id);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.update(id, patch);
    invalidateProjectionFor(id);
    await get().load();
  },

  remove: async (id) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.delete(id);
    invalidateProjectionFor(id);
    await get().load();
  },

  setActive: async (id) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.setActive(id);
    await get().load();
  },

  updateLever: async (id, partial) => {
    const repo = new ScenariosRepo(getDatabase());
    const existing = get().scenarios.find((s) => s.id === id);
    if (!existing) throw new Error(`Scenario ${id} not found in store`);
    const mergedPayload: LeverPayload = { ...existing.leverPayload, ...partial };
    await repo.update(id, { leverPayload: mergedPayload });
    invalidateProjectionFor(id);
    await get().load();
  },

  duplicate: async (sourceId, newName) => {
    const repo = new ScenariosRepo(getDatabase());
    const source = get().scenarios.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Scenario ${sourceId} not found in store`);
    const copyInput: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> = {
      name: newName ?? `${source.name} (copy)`,
      isBaseline: false,
      isActive: false,
      color: source.color,
      lineStyle: source.lineStyle,
      visible: source.visible,
      sortOrder: source.sortOrder + 1,
      leverPayload: source.leverPayload,
    };
    const newId = await repo.create(copyInput);
    await get().load();
    return newId;
  },

  rename: async (id, newName) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.update(id, { name: newName });
    await get().load();
  },

  setHorizonMonths: (months) => {
    const clamped = Math.max(60, Math.min(480, Math.round(months)));
    projectionCache.clear();
    set({ horizonMonths: clamped });
  },

  setDollarMode: (mode) => {
    set({ dollarMode: mode });
  },

  toggleVisibility: async (id) => {
    const repo = new ScenariosRepo(getDatabase());
    const existing = get().scenarios.find((s) => s.id === id);
    if (!existing) throw new Error(`Scenario ${id} not found in store`);
    await repo.update(id, { visible: !existing.visible });
    await get().load();
  },

  saveCurrentAsScenario: async (newName) => {
    const repo = new ScenariosRepo(getDatabase());
    const scenarios = get().scenarios;
    const active = scenarios.find((s) => s.isActive) ?? scenarios.find((s) => s.isBaseline);
    if (!active) throw new Error('No active scenario to snapshot');
    const maxSort = scenarios.reduce((acc, s) => Math.max(acc, s.sortOrder), 0);
    const input: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> = {
      name: newName,
      isBaseline: false,
      isActive: false,
      color: active.color,
      lineStyle: active.lineStyle,
      visible: true,
      sortOrder: maxSort + 1,
      leverPayload: active.leverPayload,
    };
    const newId = await repo.create(input);
    await get().load();
    return newId;
  },

  projectedScenarios: (real) => {
    const state = get();
    const out = new Map<number, MonthlyState[]>();

    const defaultsKey = `${state.inflation}|${state.defaultReturnRate}`;
    const horizonKey = `${real.startISO}|${state.horizonMonths}`;
    const realKey = realFingerprint(real);

    for (const sc of state.scenarios) {
      if (!sc.visible) continue;
      if (sc.id == null) continue;
      const id = sc.id;
      const leverKey = JSON.stringify(sc.leverPayload);
      const key = `${leverKey}|${horizonKey}|${defaultsKey}|${realKey}`;

      const cached = projectionCache.get(id);
      if (cached && cached.key === key) {
        out.set(id, cached.states);
        continue;
      }

      const states = projectScenario(real, sc.leverPayload, {
        startISO: real.startISO,
        months: state.horizonMonths,
      });
      projectionCache.set(id, { states, key });
      out.set(id, states);
    }

    return out;
  },
}));

/**
 * Cheap stable fingerprint of the user-data slice of RealState. Used as
 * part of the projection cache key so that mutations to accounts,
 * snapshots, persons, loans, household defaults, or tax rules
 * invalidate cached projections — without this, the engine returns
 * stale results after the user adds an account or edits a balance.
 *
 * Design notes (NEW-W7-WI2):
 *   - The fingerprint covers everything `captureRealState` reads from
 *     the user's stores. The cached `MonthlyState[]` is a pure function
 *     of (RealState, LeverPayload, horizon), and only RealState was
 *     missing from the prior cache key.
 *   - We hash counts + summed balance totals + identifying scalars, not
 *     full JSON dumps — JSON.stringify on the entire RealState would
 *     dominate the projection cost it's meant to gate.
 *   - `initialInvestmentsByAccount` is the projection's actual starting
 *     point, so its sum is the most direct collision-resistant signal
 *     for "snapshots / holdings / per-account balances changed".
 *   - Standard deductions and tax bracket counts are folded in so that
 *     a tax-year change (or a jurisdiction edit on household) flips
 *     the key as well.
 */
function realFingerprint(real: RealState): string {
  // Every field below is defensive against partial RealState shapes —
  // tests + back-compat callers may pass fixtures that omit slices
  // captureRealState always populates. A missing field hashes to 0 /
  // 'null' rather than throwing, which preserves the invariant
  // "same inputs → same key" while never crashing the projection path.
  const h = real.household ?? ({} as RealState['household']);
  const accounts = real.accounts ?? [];
  const persons = real.persons ?? [];
  const loans = real.loans ?? [];
  const holdings = real.holdings ?? [];
  const accountsByBucket = real.accountsByBucket ?? {
    taxAdvantaged: [],
    brokerage: [],
    cash: [],
  };
  const initialInvestmentsByAccount = real.initialInvestmentsByAccount ?? {};
  const investmentSum = Object.values(initialInvestmentsByAccount)
    .reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
  const loanSum = loans.reduce((sum, l) => sum + (l?.currentBalance ?? 0), 0);
  const tb = real.taxBrackets ?? null;
  const td = tb?.standardDeduction;
  const defaults = real.defaults ?? ({} as RealState['defaults']);
  return [
    accounts.length,
    persons.length,
    loans.length,
    holdings.length,
    h.id ?? 'no-id',
    h.filingStatus ?? '',
    h.state ?? '',
    h.city ?? '',
    h.monthlyExpenseBaseline ?? 0,
    h.withdrawalRate ?? 0,
    h.inflationAssumption ?? 0,
    real.startISO ?? '',
    accountsByBucket.taxAdvantaged.length,
    accountsByBucket.brokerage.length,
    accountsByBucket.cash.length,
    Math.round(real.initialCash ?? 0),
    Math.round(investmentSum),
    Math.round(loanSum),
    // Wave 2 §5: physical-asset seed must invalidate cached projections when
    // a property/vehicle value changes, or the chart survives the edit stale.
    Math.round(real.initialPhysicalAssets ?? 0),
    tb?.federal?.length ?? 0,
    tb?.state?.length ?? 0,
    tb?.city?.length ?? 0,
    tb?.ltcg?.length ?? 0,
    td?.federal ?? 0,
    td?.state ?? 0,
    td?.city ?? 0,
    defaults.inflation ?? 'null',
    defaults.returnRate ?? 'null',
    defaults.defaultCashApy ?? 'null',
    defaults.defaultDrawdownTaxRate ?? 'null',
  ].join('|');
}

function invalidateProjectionFor(id: number) {
  projectionCache.delete(id);
}

