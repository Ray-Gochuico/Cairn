import { describe, it, expect } from 'vitest';
import {
  aggregateHouseholdPretax,
  computeSupplementalWageTax,
  flatSupplementalWithholding,
} from '@/lib/calculators/supplemental-wage';
import { computeBonusTax, computePretaxDeductions } from '@/lib/tax';
import { FilingStatus } from '@/types/enums';
import type { Person } from '@/types/schema';

const federalSingleBrackets = [
  { min: 0, max: 11925, rate: 0.1 },
  { min: 11925, max: 48475, rate: 0.12 },
  { min: 48475, max: 103350, rate: 0.22 },
  { min: 103350, max: 197300, rate: 0.24 },
  { min: 197300, max: 250525, rate: 0.32 },
  { min: 250525, max: 626350, rate: 0.35 },
  { min: 626350, max: null, rate: 0.37 },
];
const caSingleBrackets = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
  { min: 24684, max: 38959, rate: 0.04 },
  { min: 38959, max: 54081, rate: 0.06 },
  { min: 54081, max: 68350, rate: 0.08 },
  { min: 68350, max: 349137, rate: 0.093 },
  { min: 349137, max: 418961, rate: 0.103 },
  { min: 418961, max: 698271, rate: 0.113 },
  { min: 698271, max: null, rate: 0.123 },
];

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'Alice',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
    ...overrides,
  } as Person;
}

describe('aggregateHouseholdPretax', () => {
  it('sums salary + pretax across the supplied persons and matches computePretaxDeductions', () => {
    const persons = [person({ annualSalaryPretax: 100000 }), person({ id: 2, annualSalaryPretax: 60000 })];
    const out = aggregateHouseholdPretax(persons, {
      filingStatus: FilingStatus.MFJ,
      personCount: 2,
      dependentCount: 0,
    });
    expect(out.totalSalary).toBe(160000);
    // pretax is the per-person computePretaxDeductions summed
    const p0 = computePretaxDeductions({
      salary: 100000, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 0, hsaMonthly: 0, hsaEligible: false,
      filingStatus: FilingStatus.MFJ, personCount: 2, dependentCount: 0,
    });
    const p1 = computePretaxDeductions({
      salary: 60000, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 0, hsaMonthly: 0, hsaEligible: false,
      filingStatus: FilingStatus.MFJ, personCount: 2, dependentCount: 0,
    });
    expect(out.pretax.pretax401k).toBe(p0.pretax401k + p1.pretax401k);
    expect(out.pretax.pretaxHealth).toBe(p0.pretaxHealth + p1.pretaxHealth);
  });

  it('supports a single-person subset (Overtime case)', () => {
    const all = [person({ annualSalaryPretax: 100000 }), person({ id: 2, annualSalaryPretax: 60000 })];
    const out = aggregateHouseholdPretax([all[0]], {
      filingStatus: FilingStatus.SINGLE,
      personCount: all.length, // household-wide caps still see both persons
      dependentCount: 0,
    });
    expect(out.totalSalary).toBe(100000);
  });
});

describe('aggregateHouseholdPretax — per-RETURN caps (round-3 M1)', () => {
  const opts = { filingStatus: FilingStatus.MFJ, personCount: 2, dependentCount: 1 };

  it('DCFSA caps ONCE per return, not per earner: 2 × $400/mo → $7,500, not $9,600', () => {
    // Each earner elects $4,800/yr — individually under the $7,500 §129 cap,
    // so the pre-fix per-person-then-sum path passed $9,600 through. The
    // limit is per TAX RETURN: min(9,600, 7,500) = $7,500.
    const agg = aggregateHouseholdPretax(
      [person({ id: 1, dependentCareFsaMonthly: 400 }), person({ id: 2, dependentCareFsaMonthly: 400 })],
      opts,
    );
    expect(agg.pretax.pretaxDcfsa).toBe(7_500);
  });

  it('MFS uses the $3,750 DCFSA cap', () => {
    const agg = aggregateHouseholdPretax(
      [person({ id: 1, dependentCareFsaMonthly: 400 })],
      { ...opts, filingStatus: FilingStatus.MFS, personCount: 1, dependentCount: 1 },
    );
    expect(agg.pretax.pretaxDcfsa).toBe(3_750);
  });

  it('HSA caps ONCE at the household (family) limit: 2 × $500/mo eligible → $8,750, not $12,000', () => {
    // Pre-fix: each earner got the FULL family cap (hsaLimitForHousehold
    // returns 8,750 whenever personCount > 1), so 2 × min(6,000, 8,750)
    // = $12,000 flowed through. The family limit is a single shared cap.
    const agg = aggregateHouseholdPretax(
      [
        person({ id: 1, hsaMonthlyContribution: 500, hsaEligible: true }),
        person({ id: 2, hsaMonthlyContribution: 500, hsaEligible: true }),
      ],
      opts,
    );
    expect(agg.pretax.pretaxHsa).toBe(8_750);
  });

  it('an hsaEligible:false earner contributes nothing to the HSA leg', () => {
    const agg = aggregateHouseholdPretax(
      [
        person({ id: 1, hsaMonthlyContribution: 500, hsaEligible: true }),
        person({ id: 2, hsaMonthlyContribution: 500, hsaEligible: false }),
      ],
      opts,
    );
    expect(agg.pretax.pretaxHsa).toBe(6_000); // only earner 1's $6,000, under the cap
  });

  it('401(k) stays PER EMPLOYEE: two $200k earners at 15% → 2 × $24,500 = $49,000', () => {
    const agg = aggregateHouseholdPretax(
      [
        person({ id: 1, annualSalaryPretax: 200_000, pretax401kPct: 0.15 }),
        person({ id: 2, annualSalaryPretax: 200_000, pretax401kPct: 0.15 }),
      ],
      opts,
    );
    expect(agg.pretax.pretax401k).toBe(49_000);
  });
});

describe('computeSupplementalWageTax — golden parity with computeBonusTax', () => {
  // GOLDEN GATE: computeSupplementalWageTax is a thin wrapper; it MUST produce
  // byte-identical output to the proven computeBonusTax for the same scenario.
  // Any drift fails here — this is the exact-value gate the migration relies on.
  const pretax = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };
  const scenarios = [
    { name: 'bonus $10k on $100k SINGLE/CA', baseSalary: 100000, supplementalWages: 10000 },
    { name: 'overtime $4k on $80k SINGLE/CA', baseSalary: 80000, supplementalWages: 4000 },
    { name: 'commission $48k on $100k SINGLE/CA', baseSalary: 100000, supplementalWages: 48000 },
  ];
  for (const s of scenarios) {
    it(`${s.name} equals computeBonusTax exactly`, () => {
      const sd = { federal: 15000, state: 0, city: 0 };
      const viaEngine = computeSupplementalWageTax({
        baseSalary: s.baseSalary,
        supplementalWages: s.supplementalWages,
        pretax,
        filingStatus: FilingStatus.SINGLE,
        federalBrackets: federalSingleBrackets,
        stateBrackets: caSingleBrackets,
        cityBrackets: null,
        standardDeduction: sd,
      });
      const viaBonus = computeBonusTax({
        personGross: s.baseSalary + s.supplementalWages,
        bonus: s.supplementalWages,
        pretax,
        filingStatus: FilingStatus.SINGLE,
        federalBrackets: federalSingleBrackets,
        stateBrackets: caSingleBrackets,
        cityBrackets: null,
        standardDeduction: sd,
      });
      expect(viaEngine).toEqual(viaBonus);
      expect(viaEngine.bonusBreakdown.total).toBeGreaterThan(0);
    });
  }
});

describe('flatSupplementalWithholding', () => {
  it('applies 22% below the $1M threshold', () => {
    expect(flatSupplementalWithholding(10_000)).toBeCloseTo(2_200, 6);
    expect(flatSupplementalWithholding(1_000_000)).toBeCloseTo(220_000, 6);
  });
  it('applies 37% to the portion over $1M', () => {
    // 220_000 + 500_000 * 0.37 = 405_000
    expect(flatSupplementalWithholding(1_500_000)).toBeCloseTo(405_000, 6);
  });
  it('is 0 for non-positive wages', () => {
    expect(flatSupplementalWithholding(0)).toBe(0);
    expect(flatSupplementalWithholding(-5)).toBe(0);
  });
});
