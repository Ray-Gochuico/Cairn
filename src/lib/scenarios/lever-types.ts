import { z } from 'zod';
import { CompoundingFrequency } from '@/types/enums';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE, 'must be YYYY-MM-DD');

export const ExtraLoanPaymentSchema = z.object({
  loanId: z.number().int().positive(),
  extraMonthly: z.number().nonnegative(),
  start: isoDate.optional(),
  end: isoDate.optional(),
});
export type ExtraLoanPayment = z.infer<typeof ExtraLoanPaymentSchema>;

export const LumpSumEventSchema = z.object({
  when: isoDate,
  amount: z.number(),
  destination: z.enum(['cash', 'investments']),
  label: z.string().optional(),
});
export type LumpSumEvent = z.infer<typeof LumpSumEventSchema>;

export const ExpensePeriodSchema = z.object({
  start: isoDate,
  monthlyDelta: z.number(),
  durationMonths: z.number().int().positive(),
  label: z.string().optional(),
});
export type ExpensePeriod = z.infer<typeof ExpensePeriodSchema>;

export const ReturnScheduleSchema = z.object({
  defaultRate: z.number().min(-1).max(1),
  overrides: z.record(z.string().regex(/^\d{4}$/), z.number().min(-1).max(1)),
  /** Per-scenario cash APY override. null = use canonical balance-weighted APY. */
  cashRate: z.number().min(0).max(0.15).nullable().default(null),
  /**
   * Per-scenario compounding frequency. Applies to BOTH investment returns
   * and cash APY — for v1 the two share a single frequency. Defaults to
   * MONTHLY, which preserves pre-Task-16 engine semantics exactly.
   */
  compoundingFrequency: z
    .nativeEnum(CompoundingFrequency)
    .default(CompoundingFrequency.MONTHLY),
});
export type ReturnSchedule = z.infer<typeof ReturnScheduleSchema>;

/**
 * Per-scenario inflation schedule. Mirrors {@link ReturnScheduleSchema}:
 *
 *   - `defaultRate`   — scenario-wide annual inflation. null = fall through to
 *                       household.inflationAssumption / app_settings.defaultInflation.
 *   - `overrides`     — per-year overrides keyed by 4-digit year string. Lets
 *                       the user model a high-inflation 2027 shock without
 *                       changing the rest of the curve.
 *
 * Range is wider than typical (-5% deflation to +20% inflation) so users can
 * model deflationary scenarios and 1970s-style stagflation.
 */
export const InflationScheduleSchema = z.object({
  /**
   * Per-scenario default annual inflation rate (fraction). null = use
   * household.inflationAssumption → app_settings.defaultInflation → 0.03.
   */
  defaultRate: z.number().min(-0.05).max(0.20).nullable().default(null),
  /** Per-year overrides keyed by 4-digit year string. */
  overrides: z.record(z.string().regex(/^\d{4}$/), z.number().min(-0.05).max(0.20)).default({}),
});
export type InflationSchedule = z.infer<typeof InflationScheduleSchema>;

export const IncomeEventSchema = z.discriminatedUnion('type', [
  z.object({ when: isoDate, type: z.literal('raise'),       deltaAmount: z.number(),        label: z.string().optional() }),
  z.object({ when: isoDate, type: z.literal('promotion'),   newSalary: z.number().nonnegative(), label: z.string().optional() }),
  z.object({ when: isoDate, type: z.literal('cut'),         newSalary: z.number().nonnegative(), label: z.string().optional() }),
  z.object({ when: isoDate, type: z.literal('job_change'),  newSalary: z.number().nonnegative(), label: z.string().optional() }),
  z.object({ when: isoDate, type: z.literal('sabbatical'),  durationMonths: z.number().int().positive(), resumesAt: z.number().nonnegative().optional(), label: z.string().optional() }),
]);
export type IncomeEvent = z.infer<typeof IncomeEventSchema>;

export const PersonIncomePlanSchema = z.object({
  annualRaiseRate: z.number().min(-0.5).max(0.5),
  events: z.array(IncomeEventSchema),
});
export type PersonIncomePlan = z.infer<typeof PersonIncomePlanSchema>;

export const IncomeLeverSchema = z.object({
  perPerson: z.array(PersonIncomePlanSchema).min(1).max(2),
});
export type IncomeLever = z.infer<typeof IncomeLeverSchema>;

export const ContributionSegmentSchema = z.object({
  startMonth: z.number().int().nonnegative(),
  endMonth: z.number().int().nonnegative().nullable(),
  monthlyAmount: z.number().nonnegative(),
  label: z.string().optional(),
  /**
   * Optional per-account allocation. Map of accountId (as string key) →
   * proportion (0..1). Proportions must sum to 1.0 (validated within
   * ±0.0001 tolerance). When null/undefined (default), the engine derives
   * the allocation from real contribution history or falls back to even
   * split across non-cash investment accounts.
   * Stale accountIds (deleted accounts) are ignored and re-normalized at
   * projection time — the raw data is preserved as-stored.
   */
  allocation: z
    .record(z.string().regex(/^\d+$/), z.number().min(0).max(1))
    .nullable()
    .default(null)
    .refine(
      (a) =>
        a == null ||
        Math.abs(Object.values(a).reduce((s, p) => s + p, 0) - 1) < 0.0001,
      { message: 'allocation proportions must sum to 1' },
    ),
});
export type ContributionSegment = z.infer<typeof ContributionSegmentSchema>;

export const ContributionsLeverSchema = z.array(ContributionSegmentSchema);
export type ContributionsLever = z.infer<typeof ContributionsLeverSchema>;

export const LeverPayloadSchema = z.object({
  extraLoanPayments: z.array(ExtraLoanPaymentSchema),
  lumpSums: z.array(LumpSumEventSchema),
  expensePeriods: z.array(ExpensePeriodSchema),
  returns: ReturnScheduleSchema,
  income: IncomeLeverSchema,
  contributions: ContributionsLeverSchema.default([]),
  /**
   * Household-level override for the retirement age at which each person's
   * salary income drops to zero. When null (default), each person retires at
   * their own Person.targetRetirementAge. The cash-floor rule then routes
   * post-retirement expenses out of investments.
   */
  retirementAgeOverride: z.number().int().min(30).max(90).nullable().default(null),
  /**
   * Per-scenario Safe Withdrawal Rate override. When null (default), the
   * FI / Coast FI math uses the household-level `withdrawalRate`. Lets the
   * user A/B "FI at 3.5% vs 4.5%" without touching household-wide config.
   */
  swrOverride: z.number().min(0.005).max(0.15).nullable().default(null),
  /**
   * Per-scenario inflation schedule. Defaults to "use household /
   * settings defaults" so existing scenarios pick up the canonical value.
   */
  inflation: InflationScheduleSchema.default({ defaultRate: null, overrides: {} }),
});
export type LeverPayload = z.infer<typeof LeverPayloadSchema>;

export function emptyLeverPayload(): LeverPayload {
  return {
    extraLoanPayments: [],
    lumpSums: [],
    expensePeriods: [],
    returns: {
      defaultRate: 0.07,
      overrides: {},
      cashRate: null,
      compoundingFrequency: CompoundingFrequency.MONTHLY,
    },
    income: { perPerson: [{ annualRaiseRate: 0, events: [] }] },
    contributions: [],
    retirementAgeOverride: null,
    swrOverride: null,
    inflation: { defaultRate: null, overrides: {} },
  };
}
