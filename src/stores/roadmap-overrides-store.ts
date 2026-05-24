import { create } from 'zustand';
import type { NodeId, RoadmapNodeOverride, OverrideStatus } from '@/types/roadmap';

/**
 * Per-node user overrides of the rule engine's computed status. Each
 * row in roadmap_node_overrides becomes one entry in
 * overridesByNodeId, keyed by NodeId for O(1) lookup during
 * evaluate().
 *
 * Sub-Plan B Task 6 wires this to the DB repo. For now the store
 * exposes the shape so context.ts and evaluate.ts can consume it.
 */
interface RoadmapOverridesState {
  overridesByNodeId: Map<NodeId, RoadmapNodeOverride>;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setOverride: (nodeId: NodeId, status: OverrideStatus, note?: string | null) => Promise<void>;
  clearOverride: (nodeId: NodeId) => Promise<void>;
}

export const useRoadmapOverridesStore = create<RoadmapOverridesState>(() => ({
  overridesByNodeId: new Map(),
  isLoading: false,
  error: null,
  load: async () => { /* Task 6 wires the repo */ },
  setOverride: async () => { /* Task 6 wires the repo */ },
  clearOverride: async () => { /* Task 6 wires the repo */ },
}));
