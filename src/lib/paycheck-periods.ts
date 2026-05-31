export type PaycheckPeriod =
  | 'ANNUAL'
  | 'SEMI_ANNUAL'
  | 'QUARTERLY'
  | 'MONTHLY'
  | 'SEMI_MONTHLY'
  | 'BI_WEEKLY'
  | 'WEEKLY'
  | 'DAILY';

export interface PaycheckPeriodDescriptor {
  id: PaycheckPeriod;
  label: string;
  periodsPerYear: number;
}

export const PAYCHECK_PERIODS: PaycheckPeriodDescriptor[] = [
  { id: 'ANNUAL',       label: 'Annual',        periodsPerYear: 1 },
  { id: 'SEMI_ANNUAL',  label: 'Semi-annual',   periodsPerYear: 2 },
  { id: 'QUARTERLY',    label: 'Quarterly',     periodsPerYear: 4 },
  { id: 'MONTHLY',      label: 'Monthly',       periodsPerYear: 12 },
  { id: 'SEMI_MONTHLY', label: 'Semi-monthly',  periodsPerYear: 24 },
  { id: 'BI_WEEKLY',    label: 'Bi-weekly',     periodsPerYear: 26 },
  { id: 'WEEKLY',       label: 'Weekly',        periodsPerYear: 52 },
  // 260 = 52 weeks × 5 workdays — standard payroll daily-rate convention.
  { id: 'DAILY',        label: 'Daily',         periodsPerYear: 260 },
];

export function periodsPerYear(p: PaycheckPeriod): number {
  const descriptor = PAYCHECK_PERIODS.find((d) => d.id === p);
  if (!descriptor) throw new Error(`Unknown period: ${p}`);
  return descriptor.periodsPerYear;
}

export function divideAnnualByPeriod(annual: number, p: PaycheckPeriod): number {
  return annual / periodsPerYear(p);
}
