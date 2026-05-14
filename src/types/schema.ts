import { z } from 'zod';
import {
  FilingStatus,
  DependentType,
  AccountType,
  ContributionSource,
  SnapshotSource,
  LoanType,
  PropertyType,
} from './enums';

const today = () => new Date().toISOString().slice(0, 10);

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

const pastOrTodayDate = isoDateString.refine(
  (d) => d <= today(),
  { message: 'Date cannot be in the future' }
);

export const GrowthScenarioSchema = z.object({
  label: z.string().min(1).max(50),
  rate: z.number().min(0).max(1),
});
export type GrowthScenario = z.infer<typeof GrowthScenarioSchema>;

export const HouseholdSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().max(100).nullable().optional(),
  filingStatus: z.nativeEnum(FilingStatus),
  state: z.string().length(2, 'Use 2-letter state code'),
  city: z.string().max(100).nullable(),
  monthlyExpenseBaseline: z.number().nonnegative(),
  withdrawalRate: z.number().min(0).max(1),
  inflationAssumption: z.number().min(0).max(1),
  growthScenarios: z.array(GrowthScenarioSchema),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const EmploymentTypeSchema = z.enum(['HOURLY', 'SALARY_NO_OT', 'SALARY_WITH_OT']);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const BonusFrequencySchema = z.enum(['ANNUAL', 'QUARTERLY']);
export type BonusFrequency = z.infer<typeof BonusFrequencySchema>;

export const PersonSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  dateOfBirth: pastOrTodayDate,
  targetRetirementAge: z.number().int().min(30).max(90),
  annualSalaryPretax: z.number().nonnegative(),
  expectedBonus: z.number().min(0).default(0),
  expectedBonusFrequency: BonusFrequencySchema.default('ANNUAL'),
  bonusIsConsistent: z.boolean().default(true),
  expectedCommission: z.number().nonnegative(),  // annual total (user enters yearly; calculator derives per-check from frequency)
  expectedCommissionFrequency: z.enum(['MONTHLY', 'QUARTERLY']),  // how often commission is paid out
  employmentType: EmploymentTypeSchema.default('SALARY_NO_OT'),
  hourlyRate: z.number().positive().nullable().default(null),
  regularHoursPerWeek: z.number().positive().default(40),
  otThresholdHoursPerWeek: z.number().positive().nullable().default(null),
  pretax401kPct: z.number().min(0).max(1),
  healthInsuranceMonthlyPremium: z.number().nonnegative(),
  dependentCareFsaMonthly: z.number().nonnegative(),
  hsaMonthlyContribution: z.number().nonnegative(),
  hsaEligible: z.boolean(),
});
export type Person = z.infer<typeof PersonSchema>;

export const DependentSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  dateOfBirth: pastOrTodayDate,
  type: z.nativeEnum(DependentType),
});
export type Dependent = z.infer<typeof DependentSchema>;

export const AccountSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive().nullable(),
  beneficiaryDependentId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  institution: z.string().max(100).nullable(),
  type: z.nativeEnum(AccountType),
  cryptoWalletAddress: z.string().max(200).nullable(),
  autoFetchEnabled: z.boolean(),
  excludedFromNetWorth: z.boolean(),
  stateOfPlan: z.string().length(2).nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const HoldingSchema = z.object({
  id: z.number().int().positive().optional(),
  accountId: z.number().int().positive(),
  ticker: z.string().min(1).max(20),
  shareCount: z.number().nonnegative(),
  targetAllocationPct: z.number().min(0).max(1).nullable(),
  costBasis: z.number().nonnegative().nullable(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const ContributionSchema = z.object({
  id: z.number().int().positive().optional(),
  accountId: z.number().int().positive(),
  personId: z.number().int().positive().nullable(),
  date: pastOrTodayDate,
  amount: z.number().nonnegative(),
  source: z.nativeEnum(ContributionSource),
});
export type Contribution = z.infer<typeof ContributionSchema>;

export const AccountSnapshotSchema = z.object({
  id: z.number().int().positive().optional(),
  accountId: z.number().int().positive(),
  snapshotDate: isoDateString,
  totalValue: z.number(),
  source: z.nativeEnum(SnapshotSource),
});
export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;

export const LoanSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  obligorPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  type: z.nativeEnum(LoanType),
  originalAmount: z.number().nonnegative(),
  currentBalance: z.number().nonnegative(),
  interestRate: z.number().min(0).max(1),
  termMonths: z.number().int().positive(),
  firstPaymentDate: isoDateString,
  monthlyPayment: z.number().nonnegative(),
  extraPaymentDefault: z.number().nonnegative(),
  linkedPropertyId: z.number().int().positive().nullable(),
  linkedVehicleId: z.number().int().positive().nullable(),
});
export type Loan = z.infer<typeof LoanSchema>;

export const LoanPaymentSchema = z.object({
  id: z.number().int().positive().optional(),
  loanId: z.number().int().positive(),
  paymentDate: isoDateString,
  principal: z.number().nonnegative(),
  interest: z.number().nonnegative(),
  extra: z.number().nonnegative(),
  source: z.enum(['AMORTIZATION', 'MANUAL', 'IMPORTED']),
});
export type LoanPayment = z.infer<typeof LoanPaymentSchema>;

export const PropertySchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  type: z.nativeEnum(PropertyType),
  address: z.string().max(200).nullable(),
  purchaseDate: pastOrTodayDate.nullable(),
  purchasePrice: z.number().nonnegative().nullable(),
  currentEstimatedValue: z.number().nonnegative().nullable(),
  linkedLoanId: z.number().int().positive().nullable(),
  excludedFromNetWorth: z.boolean(),
});
export type Property = z.infer<typeof PropertySchema>;

export const VehicleSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  year: z.number().int().min(1900).max(2100).nullable(),
  make: z.string().max(50).nullable(),
  model: z.string().max(50).nullable(),
  purchaseDate: pastOrTodayDate.nullable(),
  purchasePrice: z.number().nonnegative().nullable(),
  currentEstimatedValue: z.number().nonnegative().nullable(),
  linkedLoanId: z.number().int().positive().nullable(),
  excludedFromNetWorth: z.boolean(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

const BracketSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nullable(),
  rate: z.number().min(0).max(1),
});

export const JurisdictionType = {
  FEDERAL: 'FEDERAL',
  FICA: 'FICA',
  STATE: 'STATE',
  CITY: 'CITY',
} as const;
export type JurisdictionType = typeof JurisdictionType[keyof typeof JurisdictionType];

export const TaxRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  year: z.number().int().min(2000).max(2100),
  jurisdictionType: z.nativeEnum(JurisdictionType),
  jurisdictionCode: z.string().min(1).max(40),
  filingStatus: z.nativeEnum(FilingStatus),
  brackets: z.array(BracketSchema).min(1).refine(
    (rows) => rows.every((b, i) => i === 0 || b.min >= (rows[i - 1].max ?? Infinity)),
    'brackets must be monotonic',
  ),
  standardDeduction: z.number().nonnegative(),
});
export type TaxRule = z.infer<typeof TaxRuleSchema>;
