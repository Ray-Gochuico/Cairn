export { projectScenario, type MonthlyState, type Horizon } from './engine';
export { toReal } from './real';
export { detectMilestones, type Milestones, type FinancialIndependenceParams } from './milestones';
export { captureRealState, type RealState, type RealStateInputs, type AppSettingsSlice } from './state-snapshot';
export { effectiveSwr } from './effective-swr';
export {
  effectiveAnnualInflation,
  effectiveBaselineInflation,
  effectiveAnnualInflationFromSlice,
  captureInflationSlice,
  type InflationSlice,
} from './effective-inflation';
export { totalInvestments, aggregateByTaxBucket } from './aggregate-investments';
export type { TaxBucket } from '@/lib/account-tax-classification';
export {
  LeverPayloadSchema, emptyLeverPayload,
  ExtraLoanPaymentSchema, LumpSumEventSchema, ExpensePeriodSchema, ReturnScheduleSchema,
  InflationScheduleSchema,
  IncomeEventSchema, PersonIncomePlanSchema, IncomeLeverSchema,
  ContributionSegmentSchema, ContributionsLeverSchema,
  type LeverPayload, type ExtraLoanPayment, type LumpSumEvent, type ExpensePeriod,
  type ReturnSchedule, type InflationSchedule, type IncomeEvent, type PersonIncomePlan, type IncomeLever,
  type ContributionSegment, type ContributionsLever,
} from './lever-types';
