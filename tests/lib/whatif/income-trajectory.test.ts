import { describe, it, expect } from 'vitest';
import { incomeTrajectory } from '@/lib/whatif/income-trajectory';
import type { PersonIncomePlan } from '@/lib/scenarios';

describe('incomeTrajectory', () => {
  it('returns one entry per year for the requested horizon', () => {
    const plan: PersonIncomePlan = { annualRaiseRate: 0.03, events: [] };
    const out = incomeTrajectory({ baseSalary: 100000, plan, startYear: 2026, years: 5 });
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ year: 2026, salary: 100000 });
    expect(out[1].salary).toBeCloseTo(100000 * 1.03, 0);
  });

  it('events shift the trajectory at their fire year', () => {
    const plan: PersonIncomePlan = {
      annualRaiseRate: 0.03,
      events: [{ when: '2029-04-01', type: 'promotion', newSalary: 168000 }],
    };
    const out = incomeTrajectory({ baseSalary: 135000, plan, startYear: 2026, years: 6 });
    // Jan-each-year samples; promotion fires April 2029 (after the 2029 Jan sample),
    // so the 2030 Jan sample is the first year where the new 168k base + the 2030
    // raise have both applied: 168000 × 1.03 = 173040.
    expect(out[4].salary).toBeCloseTo(168000 * 1.03, 0);
    expect(out[5].salary).toBeCloseTo(168000 * 1.03 * 1.03, 0);
  });

  it('sabbatical does not crash and produces non-negative salaries', () => {
    const plan: PersonIncomePlan = {
      annualRaiseRate: 0.03,
      events: [{ when: '2030-07-01', type: 'sabbatical', durationMonths: 6 }],
    };
    const out = incomeTrajectory({ baseSalary: 100000, plan, startYear: 2026, years: 6 });
    expect(out.every((p) => p.salary >= 0)).toBe(true);
  });
});
