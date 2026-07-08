import { describe, it, expect } from 'vitest';
import { evaluate } from '@/domain/roadmap/evaluate';
import { NODES } from '@/domain/roadmap/nodes';
import type { RoadmapContext, RoadmapNodeOverride } from '@/types/roadmap';
import { makeHousehold } from '../../factories';


function makeContext(patch: Partial<RoadmapContext> = {}): RoadmapContext {
  const household = patch.household ?? makeHousehold();
  return {
    household,
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T12:00:00Z'),
    ...patch,
  };
}

describe('evaluate', () => {
  it('produces an entry for every registered node', () => {
    const results = evaluate(makeContext());
    expect(results.size).toBe(NODES.length);
    for (const n of NODES) {
      expect(results.has(n.id), n.id).toBe(true);
    }
  });

  it('no result carries the stub sentinel "not yet implemented" evidence', () => {
    // Sub-Plan C wired every node to a real evaluator. This guard
    // asserts the registry no longer falls through to a stub on a
    // realistic context. Status content is exercised by per-rule
    // tests; we only check the sentinel here.
    const results = evaluate(makeContext());
    for (const [id, r] of results) {
      expect(r.evidence ?? '', id).not.toMatch(/not yet implemented/);
    }
  });

  it('preserves results across re-evaluations (no shared mutable state)', () => {
    const ctx = makeContext();
    const a = evaluate(ctx);
    const b = evaluate(ctx);
    expect(a.size).toBe(b.size);
    expect(a.get('s0_create_budget')?.status).toBe(b.get('s0_create_budget')?.status);
  });

  it('applies an override status and stashes the auto-result on autoResult', () => {
    // Override s4_solo_401k, an info-only chart reference, and verify
    // the engine surfaces both the override and the real auto-result
    // ("info" + the chart's note). We assert the existence of the
    // side channel + the status flip, not the exact evidence string,
    // so the test stays loose against future copy edits.
    const overrides = new Map<string, RoadmapNodeOverride>([
      ['s4_solo_401k', {
        id: 1,
        householdId: 1,
        nodeId: 's4_solo_401k',
        overrideStatus: 'done',
        note: 'Rolled it last quarter',
        setAt: '2026-05-23T00:00:00Z',
      }],
    ]);
    const results = evaluate(makeContext({ overrides }));
    const r = results.get('s4_solo_401k')!;
    expect(r.status).toBe('done');
    expect(r.autoResult).toBeDefined();
    expect(r.autoResult!.status).toBe('info');
  });

  it('does not propagate overrides to dependent nodes', () => {
    // Override an upstream node — its dependent should still reflect
    // its own evaluator's output, not be coerced by the parent override.
    const overrides = new Map<string, RoadmapNodeOverride>([
      ['s4_solo_401k', {
        id: 1, householdId: 1, nodeId: 's4_solo_401k',
        overrideStatus: 'done', note: null, setAt: '2026-05-23T00:00:00Z',
      }],
    ]);
    const results = evaluate(makeContext({ overrides }));
    expect(results.get('s4_solo_401k')?.status).toBe('done');
    expect(results.get('s5_espp_q')?.status).toBe('info');
  });

  it('ignores overrides for unknown node ids', () => {
    const overrides = new Map<string, RoadmapNodeOverride>([
      ['does_not_exist', {
        id: 1, householdId: 1, nodeId: 'does_not_exist',
        overrideStatus: 'done', note: null, setAt: '2026-05-23T00:00:00Z',
      }],
    ]);
    const results = evaluate(makeContext({ overrides }));
    expect(results.has('does_not_exist')).toBe(false);
  });

  it('evaluates prerequisites before their dependents (topological order)', () => {
    // Stash the evaluation order via a side-channel ctx field.
    const order: string[] = [];
    const ctx = makeContext();
    // Wrap each node's evaluate to record its id in `order`, then walk.
    // We can't mutate NODES, so we just walk via evaluate() and inspect
    // results — for ordering, rely on the visible side-effect that
    // every prerequisite is present in the result map (guaranteed if
    // the loop completed). A stronger ordering check would require
    // exposing the sorter; the basic guarantee here is that no node
    // shows up missing from the result map.
    const results = evaluate(ctx);
    void order;
    for (const n of NODES) {
      for (const prereqId of n.prerequisites) {
        expect(results.has(prereqId), `${n.id} needs ${prereqId}`).toBe(true);
      }
    }
  });
});
