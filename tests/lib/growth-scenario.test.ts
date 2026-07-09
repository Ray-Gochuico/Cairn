import { describe, it, expect } from 'vitest';
import {
  pickModerateRate,
  pickModerateEntry,
  monthlyContributionAvg,
} from '@/lib/growth-scenario';
import type { Contribution, Household } from '@/types/schema';

function household(scenarios: Array<{ label: string; rate: number }>): Household {
  return { growthScenarios: scenarios } as Household;
}

describe('pickModerateRate (round-3 E7 — one home for four page-local copies)', () => {
  it('null household → 6% fallback', () => {
    expect(pickModerateRate(null)).toBe(0.06);
  });
  it('empty scenarios → 6% fallback', () => {
    expect(pickModerateRate(household([]))).toBe(0.06);
  });
  it("a labeled 'Moderate' entry wins", () => {
    expect(
      pickModerateRate(
        household([
          { label: 'Conservative', rate: 0.04 },
          { label: 'Moderate', rate: 0.065 },
          { label: 'Aggressive', rate: 0.09 },
        ]),
      ),
    ).toBe(0.065);
  });
  it('no Moderate label → the second entry', () => {
    expect(
      pickModerateRate(household([{ label: 'A', rate: 0.03 }, { label: 'B', rate: 0.07 }])),
    ).toBe(0.07);
  });
  it('single entry → the first', () => {
    expect(pickModerateRate(household([{ label: 'Only', rate: 0.05 }]))).toBe(0.05);
  });
});

describe('pickModerateEntry', () => {
  it('picks the Moderate-labeled entry, else the second, else the first', () => {
    const rows = [{ label: 'A' }, { label: 'Moderate' }, { label: 'C' }];
    expect(pickModerateEntry(rows)?.label).toBe('Moderate');
    expect(pickModerateEntry([{ label: 'A' }, { label: 'B' }])?.label).toBe('B');
    expect(pickModerateEntry([{ label: 'A' }])?.label).toBe('A');
    expect(pickModerateEntry([])).toBeUndefined();
  });
});

describe('monthlyContributionAvg', () => {
  const TODAY = new Date('2026-07-01T00:00:00Z');
  const contrib = (accountId: number, date: string, amount: number): Contribution =>
    ({ id: 1, accountId, date, amount }) as Contribution;

  it('6-month trailing average over linked contributions', () => {
    // One-off $6,000 three months ago → $1,000/mo over the 6-month window
    // (months with no contributions still divide the total down).
    const avg = monthlyContributionAvg([contrib(1, '2026-04-10', 6000)], [1], TODAY);
    expect(avg).toBe(1000);
  });

  it('ignores contributions outside the window and unlinked accounts', () => {
    const avg = monthlyContributionAvg(
      [
        contrib(1, '2025-06-01', 12000), // aged out (>6 months back)
        contrib(2, '2026-05-01', 12000), // unlinked account
        contrib(1, '2026-05-01', 3000), // in-window, linked
      ],
      [1],
      TODAY,
    );
    expect(avg).toBe(500);
  });

  it('returns 0 for no linked accounts or a non-positive window', () => {
    expect(monthlyContributionAvg([contrib(1, '2026-05-01', 100)], [], TODAY)).toBe(0);
    expect(monthlyContributionAvg([contrib(1, '2026-05-01', 100)], [1], TODAY, 0)).toBe(0);
  });
});
