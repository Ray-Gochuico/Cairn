import { z } from 'zod';

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
});
export type ReturnSchedule = z.infer<typeof ReturnScheduleSchema>;

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
});
export type LeverPayload = z.infer<typeof LeverPayloadSchema>;

export function emptyLeverPayload(): LeverPayload {
  return {
    extraLoanPayments: [],
    lumpSums: [],
    expensePeriods: [],
    returns: { defaultRate: 0.07, overrides: {} },
    income: { perPerson: [{ annualRaiseRate: 0, events: [] }] },
    contributions: [],
  };
}
