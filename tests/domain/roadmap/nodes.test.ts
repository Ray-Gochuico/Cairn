import { describe, it, expect } from 'vitest';
import { NODES, nodeById } from '@/domain/roadmap/nodes';

describe('NODES registry', () => {
  it('registers all chart nodes (49 total per spec)', () => {
    // Spec § 2 quoted "~49" total; our enumeration came out to 49.
    expect(NODES.length).toBe(49);
  });

  it('assigns a unique id to every node', () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every node belongs to a section 0..6', () => {
    for (const n of NODES) {
      expect(n.section).toBeGreaterThanOrEqual(0);
      expect(n.section).toBeLessThanOrEqual(6);
    }
  });

  it('every node has a non-empty title and body', () => {
    for (const n of NODES) {
      expect(n.title.length, n.id).toBeGreaterThan(0);
      expect(n.body.length, n.id).toBeGreaterThan(0);
    }
  });

  it('every prerequisite references an existing node id', () => {
    const ids = new Set(NODES.map((n) => n.id));
    for (const n of NODES) {
      for (const p of n.prerequisites) {
        expect(ids.has(p), `${n.id} → ${p}`).toBe(true);
      }
    }
  });

  it('node IDs use the s<section>_ prefix convention', () => {
    for (const n of NODES) {
      expect(n.id, n.id).toMatch(/^s\d_[a-z0-9_]+$/);
    }
  });

  it('nodeById returns the matching node, or undefined for a missing id', () => {
    expect(nodeById('s0_create_budget')?.title).toBe('Create a budget');
    expect(nodeById('does_not_exist')).toBeUndefined();
  });

  it('matches the per-section count documented in nodes.ts (7/10/2/7/8/7/8 = 49)', () => {
    // Spec's "approximate" tally was 7/8/2/7/8/8/9. Two adjustments
    // were made so we land at exactly 49:
    //   - Section 1 holds 10 (Task 7 requires 3 separate EF nodes —
    //     small / 3mo / 6-12mo — instead of a single combined one).
    //   - Section 5 holds 7 (merged the solo-401(k) info into the
    //     unified "Finish maxing employer plan" action since the
    //     branch is already captured by the employment-type decision).
    //   - Section 6 holds 8 (dropped the standalone debt-thresholds
    //     reference info node; that copy now lives in disclosures.ts).
    const bySection = new Map<number, number>();
    for (const n of NODES) bySection.set(n.section, (bySection.get(n.section) ?? 0) + 1);
    expect(bySection.get(0)).toBe(7);
    expect(bySection.get(1)).toBe(10);
    expect(bySection.get(2)).toBe(2);
    expect(bySection.get(3)).toBe(7);
    expect(bySection.get(4)).toBe(8);
    expect(bySection.get(5)).toBe(7);
    expect(bySection.get(6)).toBe(8);
  });

  it("Section 0 is a linear chain — each step lists only its predecessor", () => {
    const s0 = NODES.filter((n) => n.section === 0);
    expect(s0[0].prerequisites).toEqual([]);
    for (let i = 1; i < s0.length; i++) {
      expect(s0[i].prerequisites.length, s0[i].id).toBe(1);
      expect(s0[i].prerequisites[0]).toBe(s0[i - 1].id);
    }
  });

  it("remaining stubs return an 'info' status with a 'not yet implemented' evidence string", () => {
    // Tasks 7-10 replace stubs with real rules; those need real
    // RoadmapContexts and are exercised in their own rule tests. The
    // stub assertion here only covers the still-stubbed nodes.
    const realRuleNodeIds = new Set([
      's0_create_budget',
      's0_pay_rent',
      's0_buy_food',
      's0_pay_essentials',
      's0_income_expenses',
      's0_pay_health_care',
      's0_min_debt_payments',
      's1_emergency_small',
      's1_evaluate_non_essentials',
      's1_track_expenses',
      's1_consider_ips',
      's1_employer_match_q',
      's1_employer_match',
      's1_emergency_3mo',
      's1_emergency_6_12mo',
      's1_high_interest_debt',
      's1_job_stability_q',
      's2_moderate_debt_action',
      's3_pick_medical_insurance',
      's3_hdhp_q',
      's3_contribute_hsa',
      's3_save_receipts',
      's3_hsa_fees_q',
      's3_rollover_hsa',
      's3_keep_employer_hsa',
      's6_low_interest_debt',
      's4_ira_band',
      's4_backdoor_roth',
      's4_roth_ira',
      's4_traditional_ira',
    ]);
    const synthetic = {} as any;
    for (const n of NODES) {
      if (realRuleNodeIds.has(n.id)) continue;
      const r = n.evaluate(synthetic);
      expect(r.status, n.id).toBe('info');
      expect(r.evidence, n.id).toMatch(/not yet implemented/);
    }
  });
});
