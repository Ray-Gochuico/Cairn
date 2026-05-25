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

interface ScenariosState {
  scenarios: Scenario[];
  isLoading: boolean;
  error: string | null;

  horizonMonths: number;
  dollarMode: DollarMode;
  inflation: number;
  defaultReturnRate: number;

  projectionCache: Map<number, ProjectionCacheEntry>;

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
  projectionCache: new Map(),

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
    invalidateProjectionFor(get, set, id);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.update(id, patch);
    invalidateProjectionFor(get, set, id);
    await get().load();
  },

  remove: async (id) => {
    const repo = new ScenariosRepo(getDatabase());
    await repo.delete(id);
    invalidateProjectionFor(get, set, id);
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
    invalidateProjectionFor(get, set, id);
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
    set({ horizonMonths: clamped, projectionCache: new Map() });
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
    const next = new Map(state.projectionCache);
    const out = new Map<number, MonthlyState[]>();

    const defaultsKey = `${state.inflation}|${state.defaultReturnRate}`;
    const horizonKey = `${real.startISO}|${state.horizonMonths}`;

    for (const sc of state.scenarios) {
      if (!sc.visible) continue;
      if (sc.id == null) continue;
      const id = sc.id;
      const leverKey = JSON.stringify(sc.leverPayload);
      const key = `${leverKey}|${horizonKey}|${defaultsKey}`;

      const cached = next.get(id);
      if (cached && cached.key === key) {
        out.set(id, cached.states);
        continue;
      }

      const states = projectScenario(real, sc.leverPayload, {
        startISO: real.startISO,
        months: state.horizonMonths,
      });
      next.set(id, { states, key });
      out.set(id, states);
    }

    set({ projectionCache: next });
    return out;
  },
}));

function invalidateProjectionFor(
  get: () => ScenariosState,
  set: (partial: Partial<ScenariosState>) => void,
  id: number,
) {
  const next = new Map(get().projectionCache);
  next.delete(id);
  set({ projectionCache: next });
}

