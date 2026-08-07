import { z } from 'zod';
import { computeGoalProgress } from '@/lib/goal-progress';
import { pickModerateRate } from '@/lib/growth-scenario';
import { formatCurrency } from '@/lib/format';
import { evaluateCarSignals, type CarSignalEvaluation } from '@/lib/interview/vehicle-signals';
import type { AnswerValues, InterviewContext, InterviewThread, SubjectKey } from '@/types/interview';

/** Horizon midpoints — registry constants (design §4.2). */
const HORIZON_MONTHS = { 'replace-within-2y': 12, 'replace-2-5y': 42 } as const;
type Horizon = keyof typeof HORIZON_MONTHS;

const vehicleIdOf = (subject: SubjectKey): number => Number(subject.split(':')[1]);
const vehicleNameOf = (ctx: InterviewContext, subject: SubjectKey): string =>
  ctx.vehicles.find((v) => v.id === vehicleIdOf(subject))?.name ?? 'this vehicle';

/** CI-41: names ONLY the signals actually firing, in age/decline/repairs order. */
function basisLine(f: CarSignalEvaluation['facts']): string {
  const parts: string[] = [];
  if (f.firing.includes('age')) parts.push(`model year (${f.modelYear})`);
  if (f.firing.includes('decline')) parts.push(`value down ${f.declinePct}% over the last 12 months`);
  if (f.firing.includes('repairs')) parts.push(`${formatCurrency(f.repair12mDollars)} of categorized repairs in the last 12 months`);
  return `Based on: ${parts.join('; ')}.`;
}

const REPAIR_HONESTY =
  'Repair spend counts categorized imported transactions only — categorization is merchant-name matching.';
const NO_TRADE_IN =
  "Assumes no trade-in credit — the current car's value isn't netted against the target.";

function monthYear(today: Date, monthsAhead: number): string {
  const d = new Date(today.getTime());
  d.setUTCMonth(d.getUTCMonth() + monthsAhead);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function planReply(ctx: InterviewContext, answers: AnswerValues, subject: SubjectKey) {
  const signals = evaluateCarSignals(ctx, vehicleIdOf(subject));
  const f = signals.facts;
  const horizon = answers.get('q_keep_horizon') as Horizon;
  const months = HORIZON_MONTHS[horizon];
  const budget = answers.get('q_replacement_budget') as number;
  const rate = pickModerateRate(ctx.household);
  const targetDate = (() => {
    const d = new Date(ctx.today.getTime());
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  })();
  const progress = computeGoalProgress({
    targetAmount: budget, targetDate, currentSaved: 0,
    recentMonthlyContribution: 0, annualGrowthRate: rate, today: ctx.today,
  });
  const ratePct = Number((rate * 100).toFixed(2));
  const lines = [
    // CI-43 — null-honest, never $0:
    f.currentValueDollars == null ? 'Current value: not tracked' : `Current value: ${formatCurrency(f.currentValueDollars)}`,
    basisLine(f),
  ];
  if (f.firing.includes('repairs')) lines.push(REPAIR_HONESTY);
  if (f.unattributedRepairDollars > 0) {
    lines.push(`${formatCurrency(f.unattributedRepairDollars)} of categorized repair spending isn't linked to a specific vehicle and isn't counted here.`);
  }
  lines.push(
    `Saving ${formatCurrency(Math.round(progress.linearMonthlyNeeded))}/mo covers a ${formatCurrency(budget)} replacement by ${monthYear(ctx.today, months)}; about ${formatCurrency(Math.round(progress.monthlyNeededWithGrowth))}/mo if savings grow at ${ratePct}% (moderate scenario).`,
  );
  return {
    kind: 'plan' as const,
    title: `Replacing ${vehicleNameOf(ctx, subject)}`,
    lines,
    assumes: [NO_TRADE_IN],
  };
}

/**
 * Thread 2 — per-vehicle replacement (design §4.2). Surfaces ONLY when a
 * data-branch signal fires; quiet/unknown vehicles never render. Stable
 * IDs: vehicle_replacement / d_car_signal / q_keep_horizon /
 * q_replacement_budget / reply_replacement_plan / reply_no_plans.
 */
export const VEHICLE_REPLACEMENT_THREAD: InterviewThread = {
  id: 'vehicle_replacement',
  title: 'Vehicle replacement',
  scope: 'household',
  subject: { kind: 'vehicle' },
  entry: 'd_car_signal',
  nodes: [
    {
      kind: 'data-branch',
      id: 'd_car_signal',
      evaluate: (ctx, subject) => {
        const r = evaluateCarSignals(ctx, vehicleIdOf(subject));
        return { branch: r.branch, facts: r.facts as unknown as Record<string, unknown> };
      },
      branches: { signal: 'q_keep_horizon', quiet: null, unknown: null },
    },
    {
      kind: 'preference',
      id: 'q_keep_horizon',
      version: 1,
      prompt: (ctx, subject) => `Are there plans to replace ${vehicleNameOf(ctx, subject)}?`,
      answer: {
        kind: 'enum',
        options: [
          { value: 'replace-within-2y', label: 'Within 2 years' },
          { value: 'replace-2-5y', label: 'In 2–5 years' },
          { value: 'no-plans', label: 'No plans' },
        ],
      },
      valueSchema: z.enum(['replace-within-2y', 'replace-2-5y', 'no-plans']),
      staleAfterMonths: 12,
      storage: { kind: 'interview-answer' },
      branches: {
        'replace-within-2y': 'q_replacement_budget',
        'replace-2-5y': 'q_replacement_budget',
        'no-plans': 'reply_no_plans',
      },
    },
    {
      kind: 'preference',
      id: 'q_replacement_budget',
      version: 1,
      prompt: 'About how much would the replacement cost?',
      answer: { kind: 'amount', maxDollars: 10_000_000 },
      valueSchema: z.number().positive().max(10_000_000),
      storage: { kind: 'interview-answer' },
      branches: { '*': 'reply_replacement_plan' },
    },
    { kind: 'reply', id: 'reply_replacement_plan', compute: planReply },
    {
      kind: 'reply',
      id: 'reply_no_plans',
      compute: (ctx, _answers, subject) => ({
        kind: 'info',
        lines: [
          basisLine(evaluateCarSignals(ctx, vehicleIdOf(subject)).facts),
          'Nothing computed — you said no replacement plans. This question comes back in 12 months.',
        ],
      }),
    },
  ],
};
