export type PaycheckPeriod = 'ANNUAL' | 'QUARTERLY' | 'MONTHLY' | 'SEMI_MONTHLY' | 'BI_WEEKLY';

export interface PaycheckPeriodDescriptor {
  id: PaycheckPeriod;
  label: string;
  periodsPerYear: number;
}

export const PAYCHECK_PERIODS: PaycheckPeriodDescriptor[] = [
  { id: 'ANNUAL',       label: 'Annual',        periodsPerYear: 1 },
  { id: 'QUARTERLY',    label: 'Quarterly',     periodsPerYear: 4 },
  { id: 'MONTHLY',      label: 'Monthly',       periodsPerYear: 12 },
  { id: 'SEMI_MONTHLY', label: 'Semi-monthly',  periodsPerYear: 24 },
  { id: 'BI_WEEKLY',    label: 'Bi-weekly',     periodsPerYear: 26 },
];

export function periodsPerYear(p: PaycheckPeriod): number {
  const descriptor = PAYCHECK_PERIODS.find((d) => d.id === p);
  if (!descriptor) throw new Error(`Unknown period: ${p}`);
  return descriptor.periodsPerYear;
}

export function divideAnnualByPeriod(annual: number, p: PaycheckPeriod): number {
  return annual / periodsPerYear(p);
}
