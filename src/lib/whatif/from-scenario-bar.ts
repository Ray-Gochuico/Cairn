import { LeverPayloadSchema, emptyLeverPayload, type LeverPayload } from '@/lib/scenarios';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ScenarioBarSnapshot {
  /** Edited values; null = the field is untouched (real data). */
  portfolio: number | null;
  /** The real prefill `portfolio` replaced (delta base for the lump sum). */
  realPortfolio: number;
  monthlyContribution: number | null;
  monthlyExpenses: number | null;
  swr: number | null; // fraction (0.04)
  inflation: number | null; // fraction (0.03)
  /** Per-person edited annual salary, aligned with persons order (≤2). */
  salaryByPersonIndex: ReadonlyArray<number | null>;
}

/**
 * D6: maps scenario-bar edits onto a new What-If Scenario's leverPayload.
 * Every bar field has a lever counterpart; portfolio maps to a today-dated
 * lump sum for the DELTA vs real data (signed — downward edits work).
 * Schema-parsed so a mapping bug fails at the button, never persists.
 */
export function leverPayloadFromScenarioBar(
  snap: ScenarioBarSnapshot,
  todayIso: string,
): LeverPayload {
  const p = emptyLeverPayload();
  if (snap.portfolio != null && snap.portfolio !== snap.realPortfolio) {
    p.lumpSums.push({
      when: todayIso,
      amount: snap.portfolio - snap.realPortfolio,
      destination: 'investments',
      label: 'Scenario bar: portfolio adjustment',
    });
  }
  if (snap.monthlyContribution != null) {
    p.contributions.push({
      startMonth: 0,
      endMonth: null,
      monthlyAmount: Math.max(0, snap.monthlyContribution),
      label: 'Scenario bar: contribution',
      allocation: null,
    });
  }
  if (snap.monthlyExpenses != null) {
    p.expenseSource = 'custom';
    p.customMonthly = Math.max(0, snap.monthlyExpenses);
  }
  if (snap.swr != null) p.swrOverride = clamp(snap.swr, 0.005, 0.15);
  if (snap.inflation != null) {
    p.inflation = { defaultRate: clamp(snap.inflation, -0.05, 0.2), overrides: {} };
  }
  const perPerson = snap.salaryByPersonIndex.slice(0, 2).map((salary) => ({
    annualRaiseRate: 0,
    events:
      salary != null
        ? [
            {
              when: todayIso,
              type: 'job_change' as const,
              newSalary: Math.max(0, salary),
              label: 'Scenario bar: salary',
            },
          ]
        : [],
  }));
  if (perPerson.length > 0) p.income = { perPerson };
  return LeverPayloadSchema.parse(p);
}
