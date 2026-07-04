import { create } from 'zustand';
import { PropertiesRepo } from '@/domain/properties';
import { getDatabase } from '@/db/db';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import type { Property } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch. Carries the accepted
 * initial-mount TOCTOU documented in src/stores/persons-store.ts.
 */
let propertiesInflight: Promise<void> | null = null;

interface PropertiesState {
  properties: Property[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (property: Omit<Property, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Property, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const usePropertiesStore = create<PropertiesState>((set, get) => ({
  properties: [],
  isLoading: false,
  error: null,

  load: async () => {
    if (propertiesInflight) return propertiesInflight;
    propertiesInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new PropertiesRepo(getDatabase());
        const properties = await repo.list();
        set({ properties, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        propertiesInflight = null;
      }
    })();
    return propertiesInflight;
  },

  create: async (property) => {
    const repo = new PropertiesRepo(getDatabase());
    const id = await repo.create(property);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new PropertiesRepo(getDatabase());
    const before = get().properties.find((p) => p.id === id);
    await repo.update(id, patch);
    // Wave 2 §4: an estimate edit IS a value observation. Once an entity has
    // asset_value_snapshots, every Net Worth surface prices it at the latest
    // snapshot and the estimate field is dead weight — so record the edit as
    // today's snapshot (same-date convention enforced by upsertForDate).
    // Gated to actual CHANGES: the tabs submit the full form, so an
    // unconditional write would snapshot every unrelated edit. Cross-store
    // getState() per the household-store precedent; failures rethrow.
    if (
      patch.currentEstimatedValue !== undefined &&
      patch.currentEstimatedValue !== null &&
      before !== undefined &&
      patch.currentEstimatedValue !== before.currentEstimatedValue
    ) {
      const todayIso = new Date().toISOString().slice(0, 10);
      await useAssetValueSnapshotsStore
        .getState()
        .upsertForDate('PROPERTY', id, todayIso, patch.currentEstimatedValue);
    }
    await get().load();
  },

  remove: async (id) => {
    const repo = new PropertiesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
