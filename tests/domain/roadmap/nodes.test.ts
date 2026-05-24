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

  it("stubs return an 'info' status with a 'not yet implemented' evidence string", () => {
    const synthetic = {} as any; // stubs ignore ctx
    for (const n of NODES) {
      const r = n.evaluate(synthetic);
      // Tasks 7-9 will replace some stubs; for now every node is a stub.
      expect(r.status).toBe('info');
      expect(r.evidence).toMatch(/not yet implemented/);
    }
  });
});
