import { create } from 'zustand';
import { RoadmapOverridesRepo } from '@/domain/roadmap-overrides-repo';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import type { NodeId, RoadmapNodeOverride, OverrideStatus } from '@/types/roadmap';

/**
 * Per-node user overrides of the rule engine's computed status. Each
 * row in roadmap_node_overrides becomes one entry in
 * overridesByNodeId, keyed by NodeId for O(1) lookup during
 * evaluate(). Mutations call back to refresh the in-memory map so
 * subscribers re-render on every change.
 */
interface RoadmapOverridesState {
  overridesByNodeId: Map<NodeId, RoadmapNodeOverride>;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setOverride: (nodeId: NodeId, status: OverrideStatus, note?: string | null) => Promise<void>;
  clearOverride: (nodeId: NodeId) => Promise<void>;
}

function currentHouseholdId(): number {
  return useHouseholdStore.getState().household?.id ?? 1;
}

export const useRoadmapOverridesStore = create<RoadmapOverridesState>((set, get) => ({
  overridesByNodeId: new Map(),
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts). fetchData builds the
  // Map so the public overridesByNodeId shape is unchanged.
  load: createDedupedLoad<RoadmapOverridesState, 'overridesByNodeId'>(set, 'overridesByNodeId', async () => {
    const repo = new RoadmapOverridesRepo(getDatabase());
    const rows = await repo.list();
    const map = new Map<NodeId, RoadmapNodeOverride>();
    for (const row of rows) map.set(row.nodeId, row);
    return map;
  }),

  setOverride: async (nodeId, status, note) => {
    const repo = new RoadmapOverridesRepo(getDatabase());
    await repo.upsert({
      householdId: currentHouseholdId(),
      nodeId,
      overrideStatus: status,
      note: note ?? null,
    });
    await get().load();
  },

  clearOverride: async (nodeId) => {
    const repo = new RoadmapOverridesRepo(getDatabase());
    await repo.delete(currentHouseholdId(), nodeId);
    await get().load();
  },
}));
