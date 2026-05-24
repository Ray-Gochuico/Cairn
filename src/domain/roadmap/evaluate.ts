import { NODES } from './nodes';
import type {
  NodeId,
  NodeResult,
  RoadmapContext,
  RoadmapNode,
  RoadmapNodeOverride,
} from '@/types/roadmap';

/**
 * Walk every registered node in topological order and produce a
 * status map. Topological order means a node's `evaluate` could read
 * its prerequisites' results from the accumulator if it cares (most
 * don't — they only inspect ctx).
 *
 * After the walk, applyOverrides replaces the displayed status for any
 * node the user has overridden, keeping the original auto-result on
 * the side-channel `autoResult` so the detail drawer can show both.
 *
 * Overrides do NOT propagate: a downstream node sees the AUTO status
 * of its prerequisites, not the override. Rationale lives in the spec
 * — overrides are a UI affordance for the human's view; the
 * underlying chain still reflects what the data actually says.
 */
export function evaluate(ctx: RoadmapContext): Map<NodeId, NodeResult> {
  const out = new Map<NodeId, NodeResult>();
  for (const node of topologicalOrder(NODES)) {
    out.set(node.id, node.evaluate(ctx));
  }
  return applyOverrides(out, ctx.overrides);
}

function topologicalOrder(nodes: ReadonlyArray<RoadmapNode>): RoadmapNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const sorted: RoadmapNode[] = [];
  const visited = new Set<NodeId>();
  const inProgress = new Set<NodeId>();

  function visit(node: RoadmapNode) {
    if (visited.has(node.id)) return;
    if (inProgress.has(node.id)) {
      // Cycle detected — keep going so we don't hang, but make it loud
      // in dev so the bad prerequisite gets fixed.
      // eslint-disable-next-line no-console
      console.warn(`[roadmap.evaluate] cycle detected at node ${node.id}; skipping`);
      return;
    }
    inProgress.add(node.id);
    for (const prereqId of node.prerequisites) {
      const p = byId.get(prereqId);
      if (p) visit(p);
    }
    inProgress.delete(node.id);
    visited.add(node.id);
    sorted.push(node);
  }

  for (const n of nodes) visit(n);
  return sorted;
}

function applyOverrides(
  results: Map<NodeId, NodeResult>,
  overrides: Map<NodeId, RoadmapNodeOverride>,
): Map<NodeId, NodeResult> {
  for (const [id, ov] of overrides) {
    const auto = results.get(id);
    if (!auto) continue;
    // Strip the autoResult side channel from the saved auto-result so
    // the nesting doesn't grow on re-overrides; we always want exactly
    // one level of "this is what the rule said, this is what you set".
    const { autoResult: _strip, ...autoFlat } = auto;
    results.set(id, {
      ...auto,
      status: ov.overrideStatus,
      autoResult: autoFlat,
    });
  }
  return results;
}
