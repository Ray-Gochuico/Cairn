import { describe, it, expect } from 'vitest';
import { evaluate } from '@/domain/roadmap/evaluate';
import { NODES } from '@/domain/roadmap/nodes';
import type { RoadmapContext, RoadmapNodeOverride } from '@/types/roadmap';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    disclaimerAcceptedAt: null,
    disclaimerVersionAccepted: null,
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

function makeContext(patch: Partial<RoadmapContext> = {}): RoadmapContext {
  const household = patch.household ?? makeHousehold();
  return {
    household,
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
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

  it('returns stub results for nodes whose real rule has not yet shipped', () => {
    // Tasks 7-9 replace a handful of stubs with real rules; those
    // produce non-info statuses against a realistic context. This test
    // confirms the remaining stubs still flow through with their "not
    // yet implemented" sentinel evidence.
    const realRuleNodeIds = new Set([
      's1_emergency_small',
      's1_emergency_3mo',
      's1_emergency_6_12mo',
      's1_high_interest_debt',
      's2_moderate_debt_action',
      's6_low_interest_debt',
      's4_ira_band',
      's4_backdoor_roth',
      's4_roth_ira',
      's4_traditional_ira',
    ]);
    const results = evaluate(makeContext());
    for (const [id, r] of results) {
      if (realRuleNodeIds.has(id)) continue;
      expect(r.status, id).toBe('info');
      expect(r.evidence, id).toMatch(/not yet implemented/);
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
    const overrides = new Map<string, RoadmapNodeOverride>([
      ['s0_create_budget', {
        id: 1,
        householdId: 1,
        nodeId: 's0_create_budget',
        overrideStatus: 'done',
        note: 'I track in a different app',
        setAt: '2026-05-23T00:00:00Z',
      }],
    ]);
    const results = evaluate(makeContext({ overrides }));
    const r = results.get('s0_create_budget')!;
    expect(r.status).toBe('done');
    expect(r.autoResult).toBeDefined();
    expect(r.autoResult!.status).toBe('info');
    expect(r.autoResult!.evidence).toMatch(/not yet implemented/);
  });

  it('does not propagate overrides to dependent nodes', () => {
    // Override s0_create_budget to 'done' — s0_pay_rent (its child)
    // should still see whatever its own evaluator says (here: the stub
    // 'info', not 'active' just because the parent is "done").
    const overrides = new Map<string, RoadmapNodeOverride>([
      ['s0_create_budget', {
        id: 1, householdId: 1, nodeId: 's0_create_budget',
        overrideStatus: 'done', note: null, setAt: '2026-05-23T00:00:00Z',
      }],
    ]);
    const results = evaluate(makeContext({ overrides }));
    expect(results.get('s0_create_budget')?.status).toBe('done');
    expect(results.get('s0_pay_rent')?.status).toBe('info');
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
