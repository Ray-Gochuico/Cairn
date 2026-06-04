import {
  PersonSchema,
  LoanSchema,
  PropertySchema,
  VehicleSchema,
  EquityGrantSchema,
  AccountSchema,
  HoldingSchema,
  type Person,
  type Loan,
  type Property,
  type Vehicle,
  type EquityGrant,
  type Account,
  type Holding,
} from '@/types/schema';
import { LoanType, PropertyType, AccountType } from '@/types/enums';

/**
 * Zod-parsing fixture factories for unit tests. Each `make*` builds a minimal
 * VALID payload, merges `overrides`, then returns `Schema.parse(...)` — the
 * value is the schema's inferred type with zero `as` casts, and an invalid
 * override throws at the call site (a feature: bad fixtures fail loudly).
 *
 * Field names mirror src/types/schema.ts exactly. Only fields without a Zod
 * `.default()` are required here; defaulted fields (e.g. Person.expectedBonus,
 * Person.employmentType) are omitted and resolve through `.parse`, but may be
 * supplied via `overrides` when a test needs a specific value.
 */

export function makePerson(overrides: Partial<Person> = {}): Person {
  return PersonSchema.parse({
    householdId: 1,
    name: 'Test Person',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100_000,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
    ...overrides,
  });
}

export function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return LoanSchema.parse({
    householdId: 1,
    obligorPersonId: null,
    name: 'Test Loan',
    type: LoanType.MORTGAGE,
    originalAmount: 300_000,
    currentBalance: 250_000,
    interestRate: 0.05,
    termMonths: 360,
    firstPaymentDate: '2020-01-01',
    monthlyPayment: 1_600,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  });
}

export function makeProperty(overrides: Partial<Property> = {}): Property {
  return PropertySchema.parse({
    householdId: 1,
    ownerPersonId: null,
    name: 'Test Property',
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: null,
    linkedLoanId: null,
    excludedFromNetWorth: false,
    ...overrides,
  });
}

export function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return VehicleSchema.parse({
    householdId: 1,
    ownerPersonId: null,
    name: 'Test Vehicle',
    year: null,
    make: null,
    model: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: null,
    linkedLoanId: null,
    excludedFromNetWorth: false,
    ...overrides,
  });
}

export function makeEquityGrant(overrides: Partial<EquityGrant> = {}): EquityGrant {
  return EquityGrantSchema.parse({
    householdId: 1,
    ownerPersonId: 1,
    name: 'Test Grant',
    companyName: 'Test Co',
    grantDate: '2020-01-01',
    strikePrice: 0,
    totalShares: 1_000,
    // Single fully-vested entry: satisfies the monotonic refinement and the
    // "last entry reaches cumulativePct = 1.0" refinement.
    vestingSchedule: [{ date: '2024-01-01', cumulativePct: 1.0 }],
    currentFmv: 10,
    ...overrides,
  });
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return AccountSchema.parse({
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: 'Test Account',
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
    accentColor: null,
    ...overrides,
  });
}

export function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return HoldingSchema.parse({
    accountId: 1,
    ticker: 'VTI',
    shareCount: 10,
    targetAllocationPct: null,
    costBasis: null,
    ...overrides,
  });
}
