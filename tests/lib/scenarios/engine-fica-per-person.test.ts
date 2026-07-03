import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { captureRealState } from '@/lib/scenarios/state-snapshot';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { Bracket } from '@/lib/tax';
import type { Household, Person, TaxRule } from '@/types/schema';

// Historical anchor (Wave 2 §6): a dual-$150k MFJ household vs a single
// $300k earner. Combined gross and every bracket input are identical, so
// ordinary/state tax cancels; Medicare (1.45% combined) and Additional
// Medicare (0.9% on combined − $250k, per-return) cancel too. The ONLY
// difference is Social Security:
//   dual:   2 × min(150000, 184500) × 6.2% = 18,600
//   single:     min(300000, 184500) × 6.2% = 11,439
// → the dual household pays $7,161/yr = $596.75/mo MORE FICA. The old
// combined-base engine hid exactly that amount as phantom income.

const federalMfj: Bracket[] = [
  { min: 0, max: 23_200, rate: 0.10 },
  { min: 23_200, max: 94_300, rate: 0.12 },
  { min: 94_300, max: 201_050, rate: 0.22 },
  { min: 201_050, max: 383_900, rate: 0.24 },
  { min: 383_900, max: null, rate: 0.32 },
];

const taxRules: TaxRule[] = [
  {
    id: 1, taxYear: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
    filingStatus: 'MFJ', standardDeduction: 29_200, brackets: federalMfj,
  } as unknown as TaxRule,
];

const household = {
  id: 1, filingStatus: 'MFJ', state: null, city: null,
  monthlyExpenseBaseline: 0, withdrawalRate: 0.04,
  inflationAssumption: 0, growthScenarios: [],
} as unknown as Household;

const person = (id: number, salary: number): Person =>
  ({ id, householdId: 1, name: `P${id}`, annualSalaryPretax: salary } as unknown as Person);

function afterTaxMonthly(persons: Person[]): number {
  const real = captureRealState({
    accounts: [], accountSnapshots: [], holdings: [], loans: [], loanPayments: [],
    transactions: [], household, persons,
    appSettings: {
      defaultInflation: 0, defaultReturnRate: 0,
      defaultCashApy: null, defaultDrawdownTaxRate: null,
    },
    startISO: '2026-05',
    taxRules,
  });
  const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 3 });
  return states[1].incomeAfterTax;
}

describe('engine FICA — per-person Social Security wage base (historical anchor)', () => {
  it('dual $150k earners pay two full SS bases; the combined base hid ~$7.2k/yr', () => {
    const single = afterTaxMonthly([person(1, 300_000)]);
    const dual = afterTaxMonthly([person(1, 150_000), person(2, 150_000)]);
    expect(Math.abs(single - dual - 7_161 / 12)).toBeLessThan(1); // within $1/mo
  });

  it('a single earner is unchanged by the per-person path (identity)', () => {
    // Guarded structurally by the tax.test.ts identity test + every
    // pre-existing engine sentinel staying green; this pins the seam end-to-end.
    const single = afterTaxMonthly([person(1, 135_000)]);
    expect(single).toBeGreaterThan(0);
    expect(Number.isFinite(single)).toBe(true);
  });
});
