import type { PersonIncomePlan } from '@/lib/scenarios';
import { computeMonthlyIncomeForPerson } from '@/lib/scenarios/apply-real';

interface Input {
  baseSalary: number;
  plan: PersonIncomePlan;
  startYear: number;
  years: number;
}

export function incomeTrajectory({ baseSalary, plan, startYear, years }: Input): Array<{ year: number; salary: number }> {
  const out: Array<{ year: number; salary: number }> = [];
  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const monthISO = `${year}-01`;
    const monthly = computeMonthlyIncomeForPerson(baseSalary, plan, monthISO, startYear);
    out.push({ year, salary: monthly * 12 });
  }
  return out;
}
