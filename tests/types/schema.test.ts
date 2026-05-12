import { describe, it, expect } from 'vitest';
import {
  HouseholdSchema,
  PersonSchema,
  DependentSchema,
  GrowthScenarioSchema,
} from '@/types/schema';
import { FilingStatus, DependentType } from '@/types/enums';

describe('HouseholdSchema', () => {
  it('accepts a valid household', () => {
    const valid = {
      id: 1,
      name: 'Smith Family',
      filingStatus: FilingStatus.MFJ,
      state: 'WA',
      city: null,
      monthlyExpenseBaseline: 6500,
      withdrawalRate: 0.04,
      inflationAssumption: 0.024,
      growthScenarios: [
        { label: 'Conservative', rate: 0.05 },
        { label: 'Moderate', rate: 0.06 },
      ],
    };
    expect(() => HouseholdSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid filing status', () => {
    const invalid = {
      id: 1,
      filingStatus: 'BOGUS',
      state: 'WA',
      city: null,
      monthlyExpenseBaseline: 6500,
      withdrawalRate: 0.04,
      inflationAssumption: 0.024,
      growthScenarios: [],
    };
    expect(() => HouseholdSchema.parse(invalid)).toThrow();
  });

  it('rejects negative expense baseline', () => {
    const invalid = {
      id: 1,
      filingStatus: FilingStatus.SINGLE,
      state: 'WA',
      city: null,
      monthlyExpenseBaseline: -100,
      withdrawalRate: 0.04,
      inflationAssumption: 0.024,
      growthScenarios: [],
    };
    expect(() => HouseholdSchema.parse(invalid)).toThrow();
  });

  it('rejects withdrawal rate > 1 or < 0', () => {
    const base = {
      id: 1,
      filingStatus: FilingStatus.SINGLE,
      state: 'WA',
      city: null,
      monthlyExpenseBaseline: 5000,
      inflationAssumption: 0.024,
      growthScenarios: [],
    };
    expect(() => HouseholdSchema.parse({ ...base, withdrawalRate: 1.5 })).toThrow();
    expect(() => HouseholdSchema.parse({ ...base, withdrawalRate: -0.1 })).toThrow();
  });
});

describe('PersonSchema', () => {
  it('accepts a valid person', () => {
    const valid = {
      id: 1,
      householdId: 1,
      name: 'Alex',
      dateOfBirth: '1988-03-15',
      targetRetirementAge: 55,
      annualSalaryPretax: 140000,
      expectedBonus: 30000,
      pretax401kPct: 0.10,
      healthInsuranceMonthlyPremium: 250,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 300,
      hsaEligible: true,
    };
    expect(() => PersonSchema.parse(valid)).not.toThrow();
  });

  it('rejects DOB in the future', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const invalid = {
      id: 1,
      householdId: 1,
      name: 'Alex',
      dateOfBirth: futureDate,
      targetRetirementAge: 55,
      annualSalaryPretax: 100000,
      expectedBonus: 0,
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    };
    expect(() => PersonSchema.parse(invalid)).toThrow();
  });

  it('rejects target retirement age outside 30-90', () => {
    const base = {
      id: 1,
      householdId: 1,
      name: 'Alex',
      dateOfBirth: '1988-03-15',
      annualSalaryPretax: 100000,
      expectedBonus: 0,
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    };
    expect(() => PersonSchema.parse({ ...base, targetRetirementAge: 25 })).toThrow();
    expect(() => PersonSchema.parse({ ...base, targetRetirementAge: 95 })).toThrow();
  });
});

describe('DependentSchema', () => {
  it('accepts a valid child dependent', () => {
    const valid = {
      id: 1,
      householdId: 1,
      name: 'Riley',
      dateOfBirth: '2018-06-10',
      type: DependentType.CHILD,
    };
    expect(() => DependentSchema.parse(valid)).not.toThrow();
  });
});

describe('GrowthScenarioSchema', () => {
  it('accepts a valid scenario', () => {
    expect(() => GrowthScenarioSchema.parse({ label: 'Moderate', rate: 0.06 })).not.toThrow();
  });

  it('rejects rates outside 0-1', () => {
    expect(() => GrowthScenarioSchema.parse({ label: 'X', rate: 1.5 })).toThrow();
    expect(() => GrowthScenarioSchema.parse({ label: 'X', rate: -0.1 })).toThrow();
  });
});
