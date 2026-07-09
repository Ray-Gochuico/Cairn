import { describe, it, expect } from 'vitest';
import { CategorySchema, MerchantOverrideSchema, MerchantSeedSchema, AppSettingsSchema } from '@/types/schema';
import { RefreshCadence } from '@/types/enums';

describe('CategorySchema', () => {
  it('accepts a valid category and a null parent', () => {
    const c = CategorySchema.parse({
      id: 1, name: 'Home', parentCategoryId: null, color: '#2563eb',
      icon: '🏠', type: 'NEED', isCapital: false, systemManaged: false, monthlyBudget: null,
    });
    expect(c.name).toBe('Home');
  });
  it('rejects an empty name and an unknown type', () => {
    expect(() => CategorySchema.parse({
      name: '', parentCategoryId: null, color: null, icon: null,
      type: 'NEED', isCapital: false, systemManaged: false, monthlyBudget: null,
    })).toThrow();
    expect(() => CategorySchema.parse({
      name: 'X', parentCategoryId: null, color: null, icon: null,
      type: 'BOGUS', isCapital: false, systemManaged: false, monthlyBudget: null,
    })).toThrow();
  });
  it('accepts a monthlyBudget and a null monthlyBudget', () => {
    const base = {
      name: 'Groceries', parentCategoryId: null, color: null, icon: null,
      type: 'NEED' as const, isCapital: false, systemManaged: false,
    };
    expect(CategorySchema.parse({ ...base, monthlyBudget: null }).monthlyBudget).toBe(null);
    expect(CategorySchema.parse({ ...base, monthlyBudget: 600 }).monthlyBudget).toBe(600);
  });
  it('rejects a negative monthlyBudget', () => {
    expect(() => CategorySchema.parse({
      name: 'Groceries', parentCategoryId: null, color: null, icon: null,
      type: 'NEED', isCapital: false, systemManaged: false, monthlyBudget: -1,
    })).toThrow();
  });
});

describe('MerchantOverrideSchema / MerchantSeedSchema', () => {
  it('round-trip a valid override and seed', () => {
    expect(MerchantOverrideSchema.parse({
      householdId: 1, merchantPattern: 'PEET', categoryId: 32,
    }).merchantPattern).toBe('PEET');
    expect(MerchantSeedSchema.parse({ merchantPattern: 'PEET', categoryId: 32 }).categoryId).toBe(32);
  });
});

import {
  HouseholdSchema,
  PersonSchema,
  DependentSchema,
  GrowthScenarioSchema,
  AccountSchema,
  HoldingSchema,
  ContributionSchema,
  AccountSnapshotSchema,
  LoanSchema,
  LoanPaymentSchema,
  PropertySchema,
  VehicleSchema,
  TaxRuleSchema,
  GoalSchema,
  EquityGrantSchema,
  TickerSchema,
  FundHoldingSchema,
  AssetClass,
  Direction,
} from '@/types/schema';
import {
  FilingStatus,
  DependentType,
  AccountType,
  ContributionSource,
  SnapshotSource,
  LoanType,
  PropertyType,
  GoalType,
} from '@/types/enums';

const futureDate = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

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
      expectedCommission: 2000,
      expectedCommissionFrequency: 'MONTHLY',
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
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
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
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
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

describe('AccountSchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    ownerPersonId: 1,
    beneficiaryDependentId: null,
    name: 'Vanguard 401k',
    institution: 'Vanguard',
    type: AccountType.ACCOUNT_401K,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: 'WA',
    accentColor: null,
  };

  it('accepts a valid account', () => {
    expect(() => AccountSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown account type', () => {
    expect(() => AccountSchema.parse({ ...valid, type: 'BOGUS' })).toThrow();
  });

  it('rejects stateOfPlan that is not exactly 2 chars', () => {
    expect(() => AccountSchema.parse({ ...valid, stateOfPlan: 'WAS' })).toThrow();
    expect(() => AccountSchema.parse({ ...valid, stateOfPlan: 'W' })).toThrow();
  });

  it('rejects empty account name', () => {
    expect(() => AccountSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('parses Account with allowMargin: true', () => {
    const parsed = AccountSchema.parse({ ...valid, allowMargin: true });
    expect(parsed.allowMargin).toBe(true);
  });

  it('defaults allowMargin to false when omitted', () => {
    const { allowMargin: _omit, ...withoutAllowMargin } = { ...valid, allowMargin: false };
    const parsed = AccountSchema.parse(withoutAllowMargin);
    expect(parsed.allowMargin).toBe(false);
  });

  it('rejects non-boolean allowMargin', () => {
    expect(() => AccountSchema.parse({ ...valid, allowMargin: 'yes' })).toThrow();
  });

  it('accepts a valid hex accentColor and a null accentColor', () => {
    expect(AccountSchema.parse({ ...valid, accentColor: '#4c78a8' }).accentColor).toBe('#4c78a8');
    expect(AccountSchema.parse({ ...valid, accentColor: null }).accentColor).toBeNull();
  });

  it('rejects a malformed accentColor', () => {
    expect(() => AccountSchema.parse({ ...valid, accentColor: 'blue' })).toThrow();
    expect(() => AccountSchema.parse({ ...valid, accentColor: '#fff' })).toThrow();
  });
});

describe('HoldingSchema', () => {
  const valid = {
    id: 1,
    accountId: 1,
    ticker: 'VTI',
    shareCount: 100,
    targetAllocationPct: 0.6,
    costBasis: 12000,
  };

  it('accepts a valid holding', () => {
    expect(() => HoldingSchema.parse(valid)).not.toThrow();
  });

  it('rejects negative share count', () => {
    expect(() => HoldingSchema.parse({ ...valid, shareCount: -1 })).toThrow();
  });

  it('rejects targetAllocationPct outside 0-1', () => {
    expect(() => HoldingSchema.parse({ ...valid, targetAllocationPct: 1.5 })).toThrow();
    expect(() => HoldingSchema.parse({ ...valid, targetAllocationPct: -0.1 })).toThrow();
  });

  it('rejects empty ticker', () => {
    expect(() => HoldingSchema.parse({ ...valid, ticker: '' })).toThrow();
  });
});

describe('ContributionSchema', () => {
  const valid = {
    id: 1,
    accountId: 1,
    personId: 1,
    date: '2024-03-15',
    amount: 1500,
    source: ContributionSource.PAYCHECK,
  };

  it('accepts a valid contribution', () => {
    expect(() => ContributionSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown contribution source', () => {
    expect(() => ContributionSchema.parse({ ...valid, source: 'BOGUS' })).toThrow();
  });

  it('rejects negative amount', () => {
    expect(() => ContributionSchema.parse({ ...valid, amount: -50 })).toThrow();
  });

  it('rejects contribution date in the future', () => {
    expect(() => ContributionSchema.parse({ ...valid, date: futureDate() })).toThrow();
  });
});

describe('AccountSnapshotSchema', () => {
  const valid = {
    id: 1,
    accountId: 1,
    snapshotDate: '2024-03-15',
    totalValue: 50000,
    source: SnapshotSource.MANUAL,
  };

  it('accepts a valid snapshot', () => {
    expect(() => AccountSnapshotSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown snapshot source', () => {
    expect(() => AccountSnapshotSchema.parse({ ...valid, source: 'BOGUS' })).toThrow();
  });

  it('accepts negative totalValue (margin accounts)', () => {
    expect(() => AccountSnapshotSchema.parse({ ...valid, totalValue: -1000 })).not.toThrow();
  });

  it('accepts future snapshotDate (plain isoDateString)', () => {
    expect(() =>
      AccountSnapshotSchema.parse({ ...valid, snapshotDate: futureDate() })
    ).not.toThrow();
  });

  it('rejects malformed snapshotDate', () => {
    expect(() => AccountSnapshotSchema.parse({ ...valid, snapshotDate: '03/15/2024' })).toThrow();
  });
});

describe('LoanSchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    obligorPersonId: 1,
    name: 'Primary Mortgage',
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 350000,
    interestRate: 0.065,
    termMonths: 360,
    firstPaymentDate: '2022-06-01',
    monthlyPayment: 2528,
    extraPaymentDefault: 0,
    linkedPropertyId: 1,
    linkedVehicleId: null,
  };

  it('accepts a valid loan', () => {
    expect(() => LoanSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown loan type', () => {
    expect(() => LoanSchema.parse({ ...valid, type: 'BOGUS' })).toThrow();
  });

  it('rejects negative originalAmount', () => {
    expect(() => LoanSchema.parse({ ...valid, originalAmount: -100 })).toThrow();
  });

  it('rejects interestRate outside 0-1', () => {
    expect(() => LoanSchema.parse({ ...valid, interestRate: 1.5 })).toThrow();
    expect(() => LoanSchema.parse({ ...valid, interestRate: -0.01 })).toThrow();
  });

  it('accepts a future firstPaymentDate (plain isoDateString)', () => {
    expect(() =>
      LoanSchema.parse({ ...valid, firstPaymentDate: futureDate() })
    ).not.toThrow();
  });
});

describe('LoanPaymentSchema', () => {
  const valid = {
    id: 1,
    loanId: 1,
    paymentDate: '2024-03-15',
    principal: 500,
    interest: 1000,
    extra: 100,
    source: 'AMORTIZATION' as const,
  };

  it('accepts a valid loan payment', () => {
    expect(() => LoanPaymentSchema.parse(valid)).not.toThrow();
  });

  it('rejects unknown payment source', () => {
    expect(() => LoanPaymentSchema.parse({ ...valid, source: 'BOGUS' })).toThrow();
  });

  it('rejects negative principal', () => {
    expect(() => LoanPaymentSchema.parse({ ...valid, principal: -10 })).toThrow();
  });

  it('rejects negative interest', () => {
    expect(() => LoanPaymentSchema.parse({ ...valid, interest: -10 })).toThrow();
  });
});

describe('PropertySchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    ownerPersonId: 1,
    name: 'Seattle House',
    type: PropertyType.PRIMARY_RESIDENCE,
    address: '123 Main St',
    purchaseDate: '2021-04-01',
    purchasePrice: 600000,
    currentEstimatedValue: 750000,
    linkedLoanId: 1,
    excludedFromNetWorth: false,
  };

  it('accepts a valid property', () => {
    expect(() => PropertySchema.parse(valid)).not.toThrow();
  });

  it('accepts a property with nullable optional fields', () => {
    expect(() =>
      PropertySchema.parse({
        ...valid,
        address: null,
        purchaseDate: null,
        purchasePrice: null,
        currentEstimatedValue: null,
        linkedLoanId: null,
      })
    ).not.toThrow();
  });

  it('rejects unknown property type', () => {
    expect(() => PropertySchema.parse({ ...valid, type: 'BOGUS' })).toThrow();
  });

  it('rejects negative purchasePrice', () => {
    expect(() => PropertySchema.parse({ ...valid, purchasePrice: -100 })).toThrow();
  });

  it('rejects purchaseDate in the future', () => {
    expect(() => PropertySchema.parse({ ...valid, purchaseDate: futureDate() })).toThrow();
  });
});

describe('VehicleSchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    ownerPersonId: 1,
    name: 'Family SUV',
    year: 2020,
    make: 'Toyota',
    model: 'Highlander',
    purchaseDate: '2020-08-12',
    purchasePrice: 38000,
    currentEstimatedValue: 28000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  };

  it('accepts a valid vehicle', () => {
    expect(() => VehicleSchema.parse(valid)).not.toThrow();
  });

  it('accepts a vehicle with nullable optional fields', () => {
    expect(() =>
      VehicleSchema.parse({
        ...valid,
        year: null,
        make: null,
        model: null,
        purchaseDate: null,
        purchasePrice: null,
        currentEstimatedValue: null,
      })
    ).not.toThrow();
  });

  it('rejects year outside 1900-2100', () => {
    expect(() => VehicleSchema.parse({ ...valid, year: 1899 })).toThrow();
    expect(() => VehicleSchema.parse({ ...valid, year: 2101 })).toThrow();
  });

  it('rejects negative purchasePrice', () => {
    expect(() => VehicleSchema.parse({ ...valid, purchasePrice: -100 })).toThrow();
  });

  it('rejects purchaseDate in the future', () => {
    expect(() => VehicleSchema.parse({ ...valid, purchaseDate: futureDate() })).toThrow();
  });
});

describe('TaxRuleSchema', () => {
  const valid = {
    id: 1,
    year: 2026,
    jurisdictionType: 'FEDERAL',
    jurisdictionCode: 'US',
    filingStatus: FilingStatus.SINGLE,
    brackets: [{ min: 0, max: 11600, rate: 0.10 }, { min: 11600, max: null, rate: 0.12 }],
    standardDeduction: 14600,
  };
  it('accepts a valid federal SINGLE row', () => {
    expect(() => TaxRuleSchema.parse(valid)).not.toThrow();
  });
  it('rejects bad jurisdictionType', () => {
    expect(() => TaxRuleSchema.parse({ ...valid, jurisdictionType: 'COUNTY' })).toThrow();
  });
  it('rejects rate > 1 in brackets', () => {
    expect(() => TaxRuleSchema.parse({
      ...valid, brackets: [{ min: 0, max: 100, rate: 1.5 }],
    })).toThrow();
  });
  it('rejects non-monotonic brackets', () => {
    expect(() => TaxRuleSchema.parse({
      ...valid, brackets: [{ min: 100, max: 200, rate: 0.10 }, { min: 50, max: 75, rate: 0.05 }],
    })).toThrow();
  });
});

describe('GoalSchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    forPersonId: 1,
    name: 'House Down Payment',
    type: GoalType.DOWN_PAYMENT,
    targetAmount: 80000,
    targetDate: '2030-06-01',
    linkedAccountIds: [1, 2, 3],
  };

  it('accepts a valid goal', () => {
    expect(() => GoalSchema.parse(valid)).not.toThrow();
  });

  it('rejects an invalid type', () => {
    expect(() => GoalSchema.parse({ ...valid, type: 'BOGUS' })).toThrow();
  });

  it('rejects non-array linkedAccountIds', () => {
    expect(() => GoalSchema.parse({ ...valid, linkedAccountIds: '1,2,3' })).toThrow();
    expect(() => GoalSchema.parse({ ...valid, linkedAccountIds: 1 })).toThrow();
    expect(() => GoalSchema.parse({ ...valid, linkedAccountIds: null })).toThrow();
  });

  it('allows target_date in the past', () => {
    expect(() =>
      GoalSchema.parse({ ...valid, targetDate: '2020-01-01' })
    ).not.toThrow();
  });

  it('accepts an empty linkedAccountIds array', () => {
    expect(() =>
      GoalSchema.parse({ ...valid, linkedAccountIds: [] })
    ).not.toThrow();
  });

  it('accepts forPersonId as null or a positive int', () => {
    expect(() => GoalSchema.parse({ ...valid, forPersonId: null })).not.toThrow();
    expect(() => GoalSchema.parse({ ...valid, forPersonId: 42 })).not.toThrow();
    expect(() => GoalSchema.parse({ ...valid, forPersonId: 0 })).toThrow();
    expect(() => GoalSchema.parse({ ...valid, forPersonId: -1 })).toThrow();
  });
});

describe('EquityGrantSchema', () => {
  const valid = {
    id: 1,
    householdId: 1,
    ownerPersonId: 1,
    name: 'New Hire RSU Grant',
    companyName: 'Acme Corp',
    grantDate: '2023-01-15',
    strikePrice: 0,
    totalShares: 1200,
    vestingSchedule: [
      { date: '2024-01-15', cumulativePct: 0.25 },
      { date: '2025-01-15', cumulativePct: 0.50 },
      { date: '2026-01-15', cumulativePct: 0.75 },
      { date: '2027-01-15', cumulativePct: 1.0 },
    ],
    currentFmv: 145.50,
  };

  it('accepts a valid equity grant', () => {
    expect(() => EquityGrantSchema.parse(valid)).not.toThrow();
  });

  it('accepts a single-entry vesting schedule with cumulativePct=1.0 (immediate full vest)', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [{ date: '2024-01-15', cumulativePct: 1.0 }],
      })
    ).not.toThrow();
  });

  it('rejects vesting entry with cumulativePct > 1', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [
          { date: '2024-01-15', cumulativePct: 0.5 },
          { date: '2025-01-15', cumulativePct: 1.5 },
        ],
      })
    ).toThrow();
  });

  it('rejects vesting entry with cumulativePct < 0', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [{ date: '2024-01-15', cumulativePct: -0.1 }],
      })
    ).toThrow();
  });

  it('rejects non-monotonic cumulativePct', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [
          { date: '2024-01-15', cumulativePct: 0.5 },
          { date: '2025-01-15', cumulativePct: 0.4 },
          { date: '2026-01-15', cumulativePct: 1.0 },
        ],
      })
    ).toThrow();
  });

  it('rejects non-monotonic dates', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [
          { date: '2025-01-15', cumulativePct: 0.25 },
          { date: '2024-01-15', cumulativePct: 0.50 },
          { date: '2026-01-15', cumulativePct: 1.0 },
        ],
      })
    ).toThrow();
  });

  it('rejects vestingSchedule whose last cumulativePct is not 1.0', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [
          { date: '2024-01-15', cumulativePct: 0.5 },
          { date: '2025-01-15', cumulativePct: 0.99 },
        ],
      })
    ).toThrow();
  });

  it('rejects empty vestingSchedule', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, vestingSchedule: [] })).toThrow();
  });

  it('rejects ownerPersonId === null (grants are individual)', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, ownerPersonId: null })).toThrow();
  });

  it('rejects ownerPersonId omitted', () => {
    const { ownerPersonId: _omit, ...withoutOwner } = valid;
    expect(() => EquityGrantSchema.parse(withoutOwner)).toThrow();
  });

  it('requires companyName (rejects empty string)', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, companyName: '' })).toThrow();
  });

  it('rejects negative strikePrice', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, strikePrice: -1 })).toThrow();
  });

  it('rejects negative totalShares', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, totalShares: -10 })).toThrow();
  });

  it('rejects negative currentFmv', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, currentFmv: -1 })).toThrow();
  });

  it('rejects grantDate in the future', () => {
    expect(() => EquityGrantSchema.parse({ ...valid, grantDate: futureDate() })).toThrow();
  });

  it('rejects malformed vesting entry date', () => {
    expect(() =>
      EquityGrantSchema.parse({
        ...valid,
        vestingSchedule: [{ date: '01/15/2024', cumulativePct: 1.0 }],
      })
    ).toThrow();
  });

  describe('company-valuation fields', () => {
    it('defaults the three calculator fields to null when omitted', () => {
      const parsed = EquityGrantSchema.parse(valid);
      expect(parsed.companyValuation).toBeNull();
      expect(parsed.companyOutstandingShares).toBeNull();
      expect(parsed.companyTotalDebt).toBeNull();
    });

    it('accepts non-null values for all three fields', () => {
      const parsed = EquityGrantSchema.parse({
        ...valid,
        companyValuation: 10_000_000,
        companyOutstandingShares: 5_000_000,
        companyTotalDebt: 2_000_000,
      });
      expect(parsed.companyValuation).toBe(10_000_000);
      expect(parsed.companyOutstandingShares).toBe(5_000_000);
      expect(parsed.companyTotalDebt).toBe(2_000_000);
    });

    it('accepts companyValuation = 0 (distressed company is unusual but legal)', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyValuation: 0 }),
      ).not.toThrow();
    });

    it('rejects negative companyValuation', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyValuation: -1 }),
      ).toThrow();
    });

    it('rejects zero companyOutstandingShares (would crash the formula)', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyOutstandingShares: 0 }),
      ).toThrow();
    });

    it('rejects negative companyOutstandingShares', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyOutstandingShares: -1 }),
      ).toThrow();
    });

    it('accepts companyTotalDebt = 0', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyTotalDebt: 0 }),
      ).not.toThrow();
    });

    it('rejects negative companyTotalDebt', () => {
      expect(() =>
        EquityGrantSchema.parse({ ...valid, companyTotalDebt: -1 }),
      ).toThrow();
    });
  });

  describe('grant type', () => {
    it('defaults grantType to RSU when omitted', () => {
      expect(EquityGrantSchema.parse(valid).grantType).toBe('RSU');
    });

    it('accepts each of RSU / ISO / NSO', () => {
      for (const gt of ['RSU', 'ISO', 'NSO'] as const) {
        expect(EquityGrantSchema.parse({ ...valid, grantType: gt }).grantType).toBe(gt);
      }
    });

    it('rejects an unknown grantType', () => {
      expect(() => EquityGrantSchema.parse({ ...valid, grantType: 'FOO' })).toThrow();
    });
  });
});

describe('TickerSchema', () => {
  const valid = {
    ticker: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    assetClass: AssetClass.US_TOTAL_MARKET,
    leverageFactor: 1,
    direction: Direction.LONG,
    userAdded: false,
    accentColor: null,
    sector: null,
    industry: null,
  };

  it('accepts a valid ticker', () => {
    expect(() => TickerSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid assetClass', () => {
    expect(() => TickerSchema.parse({ ...valid, assetClass: 'NOT_A_CLASS' })).toThrow();
  });

  it('rejects negative leverageFactor', () => {
    expect(() => TickerSchema.parse({ ...valid, leverageFactor: -0.1 })).toThrow();
  });

  it('defaults direction to LONG when omitted', () => {
    const { direction: _omit, ...withoutDirection } = valid;
    const result = TickerSchema.parse(withoutDirection);
    expect(result.direction).toBe('LONG');
  });

  it('defaults leverageFactor to 1.0 when omitted', () => {
    const { leverageFactor: _omit, ...withoutLeverage } = valid;
    const result = TickerSchema.parse(withoutLeverage);
    expect(result.leverageFactor).toBe(1.0);
  });

  it('defaults userAdded to false when omitted', () => {
    const { userAdded: _omit, ...withoutUserAdded } = valid;
    const result = TickerSchema.parse(withoutUserAdded);
    expect(result.userAdded).toBe(false);
  });

  it('rejects empty ticker string', () => {
    expect(() => TickerSchema.parse({ ...valid, ticker: '' })).toThrow();
  });

  it('rejects ticker longer than 20 characters', () => {
    expect(() => TickerSchema.parse({ ...valid, ticker: 'A'.repeat(21) })).toThrow();
  });

  it('accepts null name', () => {
    expect(() => TickerSchema.parse({ ...valid, name: null })).not.toThrow();
  });

  it('accepts a valid hex accentColor and a null accentColor', () => {
    expect(TickerSchema.parse({ ...valid, accentColor: '#f58518' }).accentColor).toBe('#f58518');
    expect(TickerSchema.parse({ ...valid, accentColor: null }).accentColor).toBeNull();
  });

  it('rejects a malformed accentColor', () => {
    expect(() => TickerSchema.parse({ ...valid, accentColor: 'orange' })).toThrow();
  });

  it('accepts string and null sector', () => {
    expect(TickerSchema.parse({ ...valid, sector: 'Technology' }).sector).toBe('Technology');
    expect(TickerSchema.parse({ ...valid, sector: null }).sector).toBeNull();
  });

  it('accepts string and null industry', () => {
    expect(TickerSchema.parse({ ...valid, industry: 'Software' }).industry).toBe('Software');
    expect(TickerSchema.parse({ ...valid, industry: null }).industry).toBeNull();
  });

  it('rejects sector longer than 100 characters', () => {
    expect(() => TickerSchema.parse({ ...valid, sector: 'A'.repeat(101) })).toThrow();
  });

  it('rejects industry longer than 100 characters', () => {
    expect(() => TickerSchema.parse({ ...valid, industry: 'A'.repeat(101) })).toThrow();
  });
});

import { TransactionSchema } from '@/types/schema';

describe('TransactionSchema', () => {
  it('accepts a purchase and a negative-amount credit', () => {
    const base = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    expect(TransactionSchema.parse(base).amount).toBe(54.23);
    expect(TransactionSchema.parse({ ...base, amount: -200 }).amount).toBe(-200);
  });
  it('rejects a bad date and an empty merchant', () => {
    const base = {
      householdId: 1, date: '03/05/2026', merchant: 'X', merchantRaw: null,
      amount: 1, categoryId: null, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    expect(() => TransactionSchema.parse(base)).toThrow();
    expect(() => TransactionSchema.parse({ ...base, date: '2026-03-05', merchant: '' })).toThrow();
  });
  it('accepts a personId and a null personId', () => {
    const base = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    expect(TransactionSchema.parse(base).personId).toBe(null);
    expect(TransactionSchema.parse({ ...base, personId: 2 }).personId).toBe(2);
  });
});

describe('FundHoldingSchema', () => {
  const valid = {
    fundTicker: 'VTI',
    holdingTicker: 'AAPL',
    weight: 0.05,
    asOfDate: '2025-01-15',
  };

  it('accepts a valid fund holding row', () => {
    expect(() => FundHoldingSchema.parse(valid)).not.toThrow();
  });

  it('rejects weight greater than 1', () => {
    expect(() => FundHoldingSchema.parse({ ...valid, weight: 1.01 })).toThrow();
  });

  it('rejects weight less than 0', () => {
    expect(() => FundHoldingSchema.parse({ ...valid, weight: -0.01 })).toThrow();
  });

  it('rejects bad date format (not YYYY-MM-DD)', () => {
    expect(() => FundHoldingSchema.parse({ ...valid, asOfDate: '01/15/2025' })).toThrow();
  });
});

describe('AppSettingsSchema', () => {
  const base = {
    id: 1 as const,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.EVERY_LAUNCH,
    lastRefreshAt: null,
    statementsFolderPath: null,
    lastSeenMonth: null,
    lastVisitDate: null,
    briefingBaselineDate: null,
  };

  it('accepts a valid settings object with null optionals', () => {
    const s = AppSettingsSchema.parse(base);
    expect(s.id).toBe(1);
    expect(s.notificationsEnabled).toBe(true);
    expect(s.refreshCadence).toBe('EVERY_LAUNCH');
  });

  it('accepts a populated sidebarLayout array', () => {
    const s = AppSettingsSchema.parse({
      ...base,
      sidebarLayout: [
        { to: '/', hidden: false },
        { to: '/vehicles', hidden: true },
      ],
    });
    expect(s.sidebarLayout).toHaveLength(2);
    expect(s.sidebarLayout![1]).toEqual({ to: '/vehicles', hidden: true });
  });

  it('rejects a notificationDay outside 1..28', () => {
    expect(() => AppSettingsSchema.parse({ ...base, notificationDay: 0 })).toThrow();
    expect(() => AppSettingsSchema.parse({ ...base, notificationDay: 29 })).toThrow();
  });

  it('rejects an unknown refreshCadence', () => {
    expect(() => AppSettingsSchema.parse({ ...base, refreshCadence: 'HOURLY' })).toThrow();
  });

  it('accepts a populated statementsFolderPath', () => {
    const s = AppSettingsSchema.parse({ ...base, statementsFolderPath: '/Users/me/Statements' });
    expect(s.statementsFolderPath).toBe('/Users/me/Statements');
  });
});

import {
  HousingPaymentSchema,
  HousingPaymentBaseSchema,
  VehicleLeaseSchema,
  VehicleLeaseBaseSchema,
} from '@/types/schema';

// Zod 4 disallows .omit() on a refined object schema, so the create-shape
// schema used by repos/forms is the *Base.omit({id:true}).refine(...) shape.
// The refinement helper here keeps each test case readable.
const refine = (s: { startDate: string; endDate: string | null }) =>
  s.endDate == null || s.endDate >= s.startDate;
const refineMsg = { message: 'End date must be on or after start date', path: ['endDate'] };

const housingCreateSchema = HousingPaymentBaseSchema.omit({ id: true }).refine(refine, refineMsg);
const leaseCreateSchema = VehicleLeaseBaseSchema.omit({ id: true }).refine(refine, refineMsg);

describe('HousingPaymentSchema', () => {
  const valid = {
    householdId: 1,
    ownerPersonId: null,
    name: 'Apt rent',
    monthlyAmount: 2400,
    startDate: '2026-01-01',
    endDate: null,
  };

  it('accepts a valid open-ended rental', () => {
    expect(() => housingCreateSchema.parse(valid)).not.toThrow();
  });

  it('accepts an end-dated rental', () => {
    expect(() => housingCreateSchema.parse({ ...valid, endDate: '2027-06-30' })).not.toThrow();
  });

  it('rejects negative monthly amount', () => {
    expect(() => housingCreateSchema.parse({ ...valid, monthlyAmount: -100 })).toThrow();
  });

  it('rejects end date earlier than start date', () => {
    expect(() =>
      housingCreateSchema.parse({
        ...valid,
        startDate: '2026-06-01',
        endDate: '2026-05-31',
      }),
    ).toThrow();
  });

  it('rejects blank name', () => {
    expect(() => housingCreateSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('round-trips an id-bearing row via the refined schema', () => {
    expect(() => HousingPaymentSchema.parse({ ...valid, id: 5 })).not.toThrow();
  });
});

describe('VehicleLeaseSchema', () => {
  const valid = {
    householdId: 1,
    ownerPersonId: null,
    name: 'Tesla lease',
    monthlyAmount: 599,
    startDate: '2026-03-01',
    endDate: '2029-02-28',
  };

  it('accepts a valid lease with end date', () => {
    expect(() => leaseCreateSchema.parse(valid)).not.toThrow();
  });

  it('accepts an open-ended lease (null end date)', () => {
    expect(() => leaseCreateSchema.parse({ ...valid, endDate: null })).not.toThrow();
  });

  it('rejects end date earlier than start date', () => {
    expect(() =>
      leaseCreateSchema.parse({
        ...valid,
        startDate: '2026-03-01',
        endDate: '2025-12-01',
      }),
    ).toThrow();
  });

  it('round-trips an id-bearing row via the refined schema', () => {
    expect(() => VehicleLeaseSchema.parse({ ...valid, id: 7 })).not.toThrow();
  });
});

import {
  LearningStateSchema,
  LearningAnswerSchema,
} from '@/types/schema';
import { LearningDifficulty } from '@/types/enums';

describe('LearningStateSchema', () => {
  it('applies defaults for an empty object', () => {
    const parsed = LearningStateSchema.parse({});
    expect(parsed.id).toBe(1);
    expect(parsed.difficultyPreference).toBe(LearningDifficulty.MIXED);
    expect(parsed.streakCount).toBe(0);
    expect(parsed.lastShownQuestionId).toBeNull();
    expect(parsed.lastShownIsoDate).toBeNull();
    expect(parsed.lastAnsweredIsoDate).toBeNull();
  });

  it('accepts a fully populated state', () => {
    expect(() =>
      LearningStateSchema.parse({
        id: 1,
        difficultyPreference: 'Advanced',
        lastShownQuestionId: 'adv-pro-rata',
        lastShownIsoDate: '2026-05-28',
        streakCount: 7,
        lastAnsweredIsoDate: '2026-05-28',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown difficulty', () => {
    expect(() =>
      LearningStateSchema.parse({ difficultyPreference: 'Expert' }),
    ).toThrow();
  });

  it('rejects a negative streak', () => {
    expect(() => LearningStateSchema.parse({ streakCount: -1 })).toThrow();
  });
});

describe('LearningAnswerSchema', () => {
  const valid = {
    questionId: 'beg-apr',
    answeredIsoDate: '2026-05-28',
    chosenIndex: 0,
    wasCorrect: true,
    questionVersion: 1,
  };

  it('accepts a valid answer', () => {
    expect(() => LearningAnswerSchema.omit({ id: true }).parse(valid)).not.toThrow();
  });

  it('rejects chosenIndex out of 0..3', () => {
    expect(() =>
      LearningAnswerSchema.omit({ id: true }).parse({ ...valid, chosenIndex: 4 }),
    ).toThrow();
  });

  it('rejects a malformed date', () => {
    expect(() =>
      LearningAnswerSchema.omit({ id: true }).parse({ ...valid, answeredIsoDate: '2026/05/28' }),
    ).toThrow();
  });
});
