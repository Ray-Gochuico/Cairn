import { z } from 'zod';
import {
  FilingStatus,
  DependentType,
  AccountType,
  ContributionSource,
  SnapshotSource,
  LoanType,
  PropertyType,
  GoalType,
  CategoryType,
  RefreshCadence,
  FiPillsPosition,
  ProjectionDetailLevel,
  CompoundingFrequency,
  AssetSnapshotOwnerType,
  LearningDifficulty,
  GrantType,
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
  // Roadmap rule-engine chart answers + threshold overrides. All
  // nullable with no UI default; null means the user hasn't answered
  // the matching decision node yet (rule engine surfaces as 'unanswered').
  interestThresholdLowPct: z.number().nullable().default(null),
  interestThresholdHighPct: z.number().nullable().default(null),
  hasWrittenIps: z.boolean().nullable().default(null),
  hasHsaQualifiedHdhp: z.boolean().nullable().default(null),
  makesCharitableGifts: z.boolean().nullable().default(null),
  upcomingLargePurchase: z.boolean().nullable().default(null),
  upcomingPurchaseAmount: z.number().nullable().default(null),
  upcomingPurchaseMonths: z.number().nullable().default(null),
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
  // Roadmap rule-engine chart answers.
  jobStability: z.enum(['stable', 'unstable']).nullable().default(null),
  expectsHigherFutureIncome: z.boolean().nullable().default(null),
  onParentHealthInsurance: z.boolean().nullable().default(null),
  isRelativelyHealthy: z.boolean().nullable().default(null),
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
  allowMargin: z.boolean().default(false),
  stateOfPlan: z.string().length(2).nullable(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color')
    .nullable(),
  // Roadmap rule-engine chart answers (per-account, e.g. 401(k) match).
  hasEmployerMatch: z.boolean().nullable().default(null),
  employerMatchPct: z.number().nullable().default(null),
  employerMatchLimitPct: z.number().nullable().default(null),
  allowsMegaBackdoorRollover: z.boolean().nullable().default(null),
  hasHighFees: z.boolean().nullable().default(null),
  apyRate: z.number().min(0).max(0.15).nullable().default(null),
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

// Manually entered dated value snapshot for a property or vehicle. The
// discriminated union (PROPERTY | VEHICLE) means cascading deletes are
// repo-layer concerns — see PropertiesRepo.delete / VehiclesRepo.delete.
export const AssetValueSnapshotSchema = z.object({
  id: z.number().int().positive().optional(),
  ownerType: z.nativeEnum(AssetSnapshotOwnerType),
  ownerId: z.number().int().positive(),
  snapshotDate: isoDateString,
  value: z.number().nonnegative(),
});
export type AssetValueSnapshot = z.infer<typeof AssetValueSnapshotSchema>;

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

export const GoalSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  forPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  type: z.nativeEnum(GoalType),
  targetAmount: z.number().nonnegative(),
  targetDate: isoDateString,
  linkedAccountIds: z.array(z.number().int().positive()),
});
export type Goal = z.infer<typeof GoalSchema>;

const BracketSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nullable(),
  rate: z.number().min(0).max(1),
});

export const JurisdictionType = {
  FEDERAL: 'FEDERAL',
  /**
   * Long-term capital gains + qualified dividends federal schedule
   * (0% / 15% / 20%). Seeded in migration 0032 (2026 brackets).
   * Threaded through computeTotalTax via TotalTaxInput.ltcgBrackets.
   */
  FEDERAL_LTCG: 'FEDERAL_LTCG',
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

const VestingEntrySchema = z.object({
  date: isoDateString,
  cumulativePct: z.number().min(0).max(1),
});

export const EquityGrantSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive(),     // required (grants are individual)
  name: z.string().min(1).max(100),
  companyName: z.string().min(1).max(100),
  grantDate: pastOrTodayDate,
  strikePrice: z.number().nonnegative(),
  totalShares: z.number().nonnegative(),
  vestingSchedule: z.array(VestingEntrySchema).min(1).refine(
    (rows) => rows.every((r, i) => i === 0 || (r.date >= rows[i - 1].date && r.cumulativePct >= rows[i - 1].cumulativePct)),
    'vesting schedule must have monotonic dates and cumulativePct',
  ).refine(
    (rows) => Math.abs(rows[rows.length - 1].cumulativePct - 1.0) < 1e-9,
    'last vesting entry must reach cumulativePct = 1.0',
  ),
  currentFmv: z.number().nonnegative(),
  // D9 (Wave 18): read-only FMV-freshness stamp surfaced from the SQL
  // updated_at column (the repo's UPDATE already maintains it). Optional so
  // every existing payload/fixture parses unchanged; never written by the
  // repo's insert/update statements.
  updatedAt: z.string().optional(),
  // Grant-type discriminator (RSU / ISO / NSO). Defaults to 'RSU' so existing
  // payloads (and rows back-filled by migration 0044) parse unchanged. Kept in
  // lock-step with the equity_grants.grant_type CHECK + the GrantType enum.
  grantType: z.nativeEnum(GrantType).default('RSU'),
  // Optional inputs for the in-form FMV calculator. The engine never reads
  // these — they're metadata so the user can revisit and edit the breakdown
  // that produced their per-share FMV. See computeFmvFromCompanyValuation
  // in src/lib/equity-value.ts.
  companyValuation: z.number().nonnegative().nullable().default(null),
  companyOutstandingShares: z.number().positive().nullable().default(null),
  companyTotalDebt: z.number().nonnegative().nullable().default(null),
});
export type EquityGrant = z.infer<typeof EquityGrantSchema>;

export const AssetClass = {
  US_TOTAL_MARKET: 'US_TOTAL_MARKET',
  US_LARGE_CAP: 'US_LARGE_CAP',
  US_MID_CAP: 'US_MID_CAP',
  US_SMALL_CAP: 'US_SMALL_CAP',
  INTL_DEVELOPED: 'INTL_DEVELOPED',
  EMERGING_MARKETS: 'EMERGING_MARKETS',
  US_BONDS: 'US_BONDS',
  INTL_BONDS: 'INTL_BONDS',
  TIPS: 'TIPS',
  REAL_ESTATE: 'REAL_ESTATE',
  COMMODITIES: 'COMMODITIES',
  CRYPTO: 'CRYPTO',
  SINGLE_STOCK: 'SINGLE_STOCK',
  CASH: 'CASH',
  OTHER: 'OTHER',
} as const;
export type AssetClass = typeof AssetClass[keyof typeof AssetClass];

export const Direction = { LONG: 'LONG', SHORT: 'SHORT' } as const;
export type Direction = typeof Direction[keyof typeof Direction];

export const TickerSchema = z.object({
  ticker: z.string().min(1).max(20),
  name: z.string().max(200).nullable(),
  assetClass: z.nativeEnum(AssetClass),
  leverageFactor: z.number().nonnegative().default(1.0),
  direction: z.nativeEnum(Direction).default('LONG'),
  userAdded: z.boolean().default(false),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color')
    .nullable(),
  sector: z.string().max(100).nullable(),
  industry: z.string().max(100).nullable(),
});
export type Ticker = z.infer<typeof TickerSchema>;

export const FundHoldingSchema = z.object({
  fundTicker: z.string().min(1).max(20),
  holdingTicker: z.string().min(1).max(20),
  weight: z.number().min(0).max(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Human-readable name from Yahoo's holdingName (e.g. "NVIDIA Corp").
  // Nullable: Yahoo may omit it, and pre-0041 rows backfill to null.
  holdingName: z.string().nullable().default(null),
});
export type FundHolding = z.infer<typeof FundHoldingSchema>;

export const FundSectorSchema = z.object({
  fundTicker: z.string().min(1).max(20),
  sector: z.string().min(1).max(100),
  weight: z.number().min(0).max(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FundSector = z.infer<typeof FundSectorSchema>;

export const CategorySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  parentCategoryId: z.number().int().positive().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  type: z.nativeEnum(CategoryType),
  isCapital: z.boolean(),
  systemManaged: z.boolean(),
  monthlyBudget: z.number().nonnegative().nullable(),
});
export type Category = z.infer<typeof CategorySchema>;

export const MerchantOverrideSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  merchantPattern: z.string().min(1),
  categoryId: z.number().int().positive(),
  createdFromCorrectionAt: z.string().optional(),
});
export type MerchantOverride = z.infer<typeof MerchantOverrideSchema>;

export const MerchantSeedSchema = z.object({
  id: z.number().int().positive().optional(),
  merchantPattern: z.string().min(1),
  categoryId: z.number().int().positive(),
});
export type MerchantSeed = z.infer<typeof MerchantSeedSchema>;

export const TransactionSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  date: isoDateString,
  merchant: z.string().min(1),
  merchantRaw: z.string().nullable(),
  amount: z.number(), // positive = purchase, negative = payment/credit
  categoryId: z.number().int().positive().nullable(),
  sourceAccountId: z.number().int().positive().nullable(),
  propertyId: z.number().int().positive().nullable(),
  vehicleId: z.number().int().positive().nullable(),
  personId: z.number().int().positive().nullable(),
  sourcePdfFilename: z.string().nullable(),
  importedAt: z.string().optional(),
  reimbursable: z.boolean(),
  reimbursedAt: isoDateString.nullable(),
  reimbursedAmount: z.number().nullable(),
  isRecurring: z.boolean(),
  notes: z.string().nullable(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const SidebarLayoutEntrySchema = z.object({
  to: z.string(),
  hidden: z.boolean(),
});
export type SidebarLayoutEntry = z.infer<typeof SidebarLayoutEntrySchema>;

export const CardLayoutEntrySchema = z.object({
  id: z.string(),
  hidden: z.boolean(),
});
export type CardLayoutEntry = z.infer<typeof CardLayoutEntrySchema>;

export const AssetClassTargetSchema = z.object({
  assetClass: z.nativeEnum(AssetClass),
  targetPct: z.number().min(0).max(1),
});
export type AssetClassTarget = z.infer<typeof AssetClassTargetSchema>;

// Exported array schema so the repo (which does NOT import zod) can .safeParse
// the column without re-deriving the shape — mirrors how parseIdArray validates
// at the read boundary. Backend H2: keep app-settings.ts's dependency surface
// unchanged (no new `import { z } from 'zod'` there).
export const AssetClassTargetsArraySchema = z.array(AssetClassTargetSchema);

export const AppSettingsSchema = z.object({
  id: z.literal(1),
  sidebarLayout: z.array(SidebarLayoutEntrySchema).nullable(),
  investmentsCardLayout: z.array(CardLayoutEntrySchema).nullable().default(null),
  calculatorCardLayout: z.array(CardLayoutEntrySchema).nullable().default(null),
  notificationsEnabled: z.boolean(),
  notificationDay: z.number().int().min(1).max(28),
  refreshCadence: z.nativeEnum(RefreshCadence),
  lastRefreshAt: z.string().nullable(),
  statementsFolderPath: z.string().nullable(),
  defaultInflation: z.number().min(0).max(0.2).nullable().default(null),
  defaultReturnRate: z.number().min(-0.5).max(0.5).nullable().default(null),
  defaultFiPillsPosition: z.nativeEnum(FiPillsPosition).default(FiPillsPosition.ABOVE),
  defaultProjectionDetailLevel: z.nativeEnum(ProjectionDetailLevel).default('tax_bucket'),
  defaultCashApy: z.number().min(0).max(0.15).nullable().default(null),
  defaultCompoundingFrequency: z
    .nativeEnum(CompoundingFrequency)
    .default(CompoundingFrequency.MONTHLY),
  /**
   * Household-default blended effective tax rate applied to gross-up Trad
   * 401k / Trad IRA / HSA / 529 withdrawals under the SEQUENTIAL drawdown
   * strategy in the What-If projection engine. Stored as a fraction
   * (0.22 = 22%). null = unset (engine falls through to the lever payload's
   * own default of 0 — legacy net-equals-gross behavior). Surfaced via
   * Settings → Advanced as a 0..50% percent input.
   *
   * See: Finance Wave-5 review NEW-W5-1; engine.ts:607-608 reads this
   * value via real.defaults.defaultDrawdownTaxRate when the per-scenario
   * lever value is 0.
   */
  defaultDrawdownTaxRate: z.number().min(0).max(0.5).nullable().default(null),
  // User-configurable category sets for the Property "Utilities" card and
  // the Vehicle "Gas" card. null = unset (resolver falls back to seeded
  // defaults — Home > Utilities / Vehicles > Gas/Fuel); [] = explicit empty
  // (card shows empty state); [a, b, c] = sum across those category ids.
  propertyUtilitiesCategoryIds: z.array(z.number().int().positive()).nullable().default(null),
  vehicleGasCategoryIds: z.array(z.number().int().positive()).nullable().default(null),
  // Household-level asset-class target allocations — the class-led hierarchy's
  // strategic envelope. Each targetPct is a 0..1 fraction of the WHOLE
  // portfolio; the Σ ≤ 1 invariant is enforced in SettingsRepo/the form (not
  // here, so a partial in-progress edit can be held in component state). null =
  // unset. Per-ticker refinement stays on holdings.target_allocation_pct.
  assetClassTargetAllocations: AssetClassTargetsArraySchema.nullable().default(null),
  // Migration 0046: tracks the YYYY-MM of the most recent month for which the
  // app surfaced the monthly-input ritual prompt. Drives the once-per-month
  // auto-route to /monthly (Wave 3). null = never prompted (first-ever open).
  // Peer to lastRefreshAt — app/UI state, not household financial data.
  lastSeenMonth: z.string().nullable(),
  // Migration 0050: "Since your last visit" briefing stamps (Wave 13). Local
  // calendar days (YYYY-MM-DD). lastVisitDate = the most recent day the app
  // was opened; briefingBaselineDate = the visit-day before that — the
  // briefing's net-worth baseline for the whole of today (two columns so a
  // same-day re-open keeps a stable baseline). Peers to lastSeenMonth —
  // app/UI state, not household financial data. null = first-ever open.
  lastVisitDate: z.string().nullable(),
  briefingBaselineDate: z.string().nullable(),
  // NOTE: autoInvestSalarySurplus field removed 2026-05-26 (What-If revamp).
  // The migration 0029 column auto_invest_salary_surplus stays in SQL as a
  // zombie (SQLite forward-only convention); SettingsRepo no longer reads or
  // writes it. The engine's surplus routing now flows through
  // LeverPayload.gapAllocation instead of a household-level toggle.
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------------------------------------------------------------------------
// Recurring monthly obligations (added 2026-05-27, v1.1).
//
// Renters and lessees don't have a cost basis, market value, or linked loan —
// just a name, a monthly amount, a start date, and an optional end date. They
// live in tables separate from `properties` / `vehicles` so the UI and engine
// code for owned-vs-rented stay readable, and so a v2 can grow them
// independently (e.g., add security deposit, mileage cap).
//
// The end-date >= start-date refinement is applied at the schema level so
// repo writes always validate; the UI surfaces the message via the
// form-errors pane near the Save button.
//
// Zod 4 rejects `.omit()` on a refined schema, so we expose the plain
// `*Base` object (for `.omit({ id: true })` use in repos / forms) and apply
// the refinement on top. Both base and refined variants are exported so
// callers can pick the right one for their slot.
// ---------------------------------------------------------------------------

const recurringObligationRefine = (
  v: { startDate: string; endDate: string | null },
) => v.endDate == null || v.endDate >= v.startDate;
const recurringObligationRefineMsg = {
  message: 'End date must be on or after start date',
  path: ['endDate'],
};

export const HousingPaymentBaseSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  monthlyAmount: z.number().nonnegative(),
  startDate: isoDateString,
  endDate: isoDateString.nullable(),
});
export const HousingPaymentSchema = HousingPaymentBaseSchema.refine(
  recurringObligationRefine,
  recurringObligationRefineMsg,
);
export type HousingPayment = z.infer<typeof HousingPaymentSchema>;

export const VehicleLeaseBaseSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  ownerPersonId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(100),
  monthlyAmount: z.number().nonnegative(),
  startDate: isoDateString,
  endDate: isoDateString.nullable(),
});
export const VehicleLeaseSchema = VehicleLeaseBaseSchema.refine(
  recurringObligationRefine,
  recurringObligationRefineMsg,
);
export type VehicleLease = z.infer<typeof VehicleLeaseSchema>;

// ---------------------------------------------------------------------------
// Daily Trivia / Learning (v1.1, 2026-05-28).
//
// learning_state is a strict singleton (one row, id = 1) mirroring
// AppSettingsSchema. learning_answers is an append-only history; the daily
// selector reads it to exclude already-answered questions. See
// docs/superpowers/specs/2026-05-28-trivia-learning-spec.md §4.
// ---------------------------------------------------------------------------

export const LearningStateSchema = z.object({
  id: z.literal(1).default(1),
  difficultyPreference: z.nativeEnum(LearningDifficulty).default(LearningDifficulty.MIXED),
  lastShownQuestionId: z.string().nullable().default(null),
  lastShownIsoDate: z.string().nullable().default(null),
  streakCount: z.number().int().nonnegative().default(0),
  lastAnsweredIsoDate: z.string().nullable().default(null),
});
export type LearningState = z.infer<typeof LearningStateSchema>;

export const LearningAnswerSchema = z.object({
  id: z.number().int().positive().optional(),
  questionId: z.string().min(1),
  answeredIsoDate: isoDateString,
  chosenIndex: z.number().int().min(0).max(3),
  wasCorrect: z.boolean(),
  questionVersion: z.number().int().nonnegative(), // part of the one-shot grain — unread by the v1 UI, but the (question_id, question_version) UNIQUE is what enables the v1.2 re-prompt on a content correction (spec §4.1/§9.3)
});
export type LearningAnswer = z.infer<typeof LearningAnswerSchema>;
