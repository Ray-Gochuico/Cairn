import { z } from 'zod';
import { computeGoalProgress } from '@/lib/goal-progress';
import { pickModerateRate } from '@/lib/growth-scenario';
import { formatCurrency } from '@/lib/format';
import { monthlyHousingObligation } from '@/lib/recurring-obligations';
import { monthsBetweenIso } from '@/domain/interview/evaluate';
import { cashSavingsReserve, computeEfOverlap } from '@/lib/interview/cash-reserve-variants';
import { useHouseholdStore } from '@/stores/household-store';
import { AccountType, PropertyType } from '@/types/enums';
import type { AnswerValues, InterviewContext, InterviewThread } from '@/types/interview';

/** The q_target stored value (the T2 compound schema, Appendix A). */
export interface HouseTarget {
  amountDollars: number;
  /** 'YYYY-MM' — composed by the amount-month-year control. */
  targetMonth: string;
}

export const HOUSE_TARGET_SCHEMA = z.object({
  amountDollars: z.number().positive().max(10_000_000),
  targetMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/** D-HP4: the s5 window — a target further out is not "upcoming". */
const WRITE_THROUGH_MAX_MONTHS = 60;

export const monthYearLabel = (targetMonth: string): string =>
  new Date(`${targetMonth}-01T12:00:00Z`).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

/**
 * D-HP3: three-way tenure in facts, two-way branching. Owner wins over
 * renter (a landlord who also rents elsewhere is still an owner here).
 * Renter = any housing_payments row active on ctx.today with a positive
 * amount (monthlyHousingObligation > 0 — the recurring-obligations engine,
 * never a category heuristic). Pure; ctx.today only.
 */
function evaluateTenure(ctx: InterviewContext): { branch: string; facts: Record<string, unknown> } {
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const owner = ctx.properties.some((p) => p.type === PropertyType.PRIMARY_RESIDENCE);
  const rentPerMonth = monthlyHousingObligation(ctx.housingPayments, todayIso);
  const tenure = owner ? 'owner' : rentPerMonth > 0 ? 'renter' : 'unknown';
  return { branch: owner ? 'owner' : 'not-owner', facts: { tenure, monthlyHousingObligation: rentPerMonth } };
}

/**
 * D-HP4: within-window write-through so the roadmap's s5_large_purchases_q
 * stays consistent (one patch, all three columns — the ONLY writer of
 * amount/months in the app). Outside the window: writes nothing. Never
 * reversed by interview actions; RoadmapAssumptions owns clearing.
 * Called by ThreadCard on q_target save (the entity-column write side is
 * unwired in the frozen kernel — this dispatch is the honest substitute).
 */
export async function recordUpcomingPurchase(target: HouseTarget, today: Date): Promise<void> {
  const todayIso = today.toISOString().slice(0, 10);
  const months = monthsBetweenIso(todayIso, `${target.targetMonth}-01`);
  if (months < 1 || months > WRITE_THROUGH_MAX_MONTHS) return;
  await useHouseholdStore.getState().update({
    upcomingLargePurchase: true,
    upcomingPurchaseAmount: target.amountDollars,
    upcomingPurchaseMonths: months,
  });
}

function housePlanReply(ctx: InterviewContext, answers: AnswerValues) {
  const target = answers.get('q_target') as HouseTarget;
  const reserve = cashSavingsReserve(ctx.accounts, ctx.snapshots);
  const overlap = computeEfOverlap(ctx, reserve);
  const rate = pickModerateRate(ctx.household);
  const ratePct = Number((rate * 100).toFixed(2));
  const progress = computeGoalProgress({
    targetAmount: target.amountDollars,
    targetDate: `${target.targetMonth}-01`,
    currentSaved: reserve,           // D-HP5: full reserve, declared below
    recentMonthlyContribution: 0,
    annualGrowthRate: rate,
    today: ctx.today,
  });
  const when = monthYearLabel(target.targetMonth);
  const hasHsa = ctx.accounts.some(
    (a) => a.type === AccountType.ACCOUNT_HSA && a.id != null && !a.excludedFromNetWorth,
  );

  const lines: string[] = [];
  // CI-H4 — the reserve, with its basis; HSA exclusion stated when relevant.
  lines.push(
    hasHsa
      ? `Cash and savings on hand: ${formatCurrency(reserve)} — from your latest account snapshots. HSA balances aren't counted toward a down payment.`
      : `Cash and savings on hand: ${formatCurrency(reserve)} — from your latest account snapshots.`,
  );
  // CI-H5 / CI-H5b — the MANDATORY double-count declaration.
  if (overlap.baselineSource === 'none') {
    lines.push("Some of this reserve is your emergency fund — it can't be sized without an expense baseline.");
  } else if (overlap.overlapDollars > 0) {
    lines.push(
      `Of that, ${formatCurrency(overlap.overlapDollars)} is also the emergency fund the Moderate framework targets (${overlap.multiple}× expenses${overlap.assumed ? ', assumed' : ''}). The same dollars can't fund both.`,
    );
  }
  // CI-H6 / CI-H7 / CI-H8 — the plan, degrading honestly (never Infinity).
  const remaining = target.amountDollars - reserve;
  if (remaining <= 0) {
    lines.push(`Your cash and savings already cover the ${formatCurrency(target.amountDollars)} target.`);
  } else if (progress.monthsUntilTarget === 0) {
    lines.push(`${when} has arrived — ${formatCurrency(reserve)} of the ${formatCurrency(target.amountDollars)} target is on hand.`);
  } else {
    lines.push(
      `Saving ${formatCurrency(Math.round(progress.linearMonthlyNeeded))}/mo reaches ${formatCurrency(target.amountDollars)} by ${when}; about ${formatCurrency(Math.round(progress.monthlyNeededWithGrowth))}/mo if savings grow at ${ratePct}% (moderate scenario).`,
    );
  }

  const assumes = [
    'Counts your full cash and savings as down-payment savings — nothing is set aside for emergencies, closing costs, or moving.',
    "No affordability math here — mortgage rates, PMI, and debt-to-income aren't modeled, and this app fetches no reference data. The target is your number, not a suggestion.",
  ];
  // CI-H11 — claimed from LIVE household state only (D-HP4).
  if (ctx.household.upcomingLargePurchase === true && ctx.household.upcomingPurchaseAmount === target.amountDollars) {
    assumes.push("Also recorded as the Roadmap's upcoming large purchase.");
  }

  return { kind: 'plan' as const, title: 'Home down payment', lines, assumes };
}

/**
 * Thread 3 — home purchase (kernel plan Appendix A, wave T2). Owners never
 * see it (D-HP1); everyone else gets the preference-triggered ask. Stable
 * IDs, forever: home_purchase / d_tenure / q_want_house / q_target /
 * reply_house_plan / reply_someday / reply_no_plans.
 */
export const HOME_PURCHASE_THREAD: InterviewThread = {
  id: 'home_purchase',
  title: 'Home purchase',
  scope: 'household',
  entry: 'd_tenure',
  nodes: [
    {
      kind: 'data-branch',
      id: 'd_tenure',
      evaluate: (ctx) => evaluateTenure(ctx),
      branches: { owner: null, 'not-owner': 'q_want_house' },
    },
    {
      kind: 'preference',
      id: 'q_want_house',
      version: 1,
      prompt: 'Are there plans to buy a home?',
      answer: {
        kind: 'enum',
        options: [
          { value: 'yes-within-5y', label: 'Within 5 years' },
          { value: 'someday', label: 'Someday, not soon' },
          { value: 'no', label: 'No plans' },
        ],
      },
      valueSchema: z.enum(['yes-within-5y', 'someday', 'no']),
      staleAfterMonths: 24,
      storage: { kind: 'interview-answer' },
      branches: {
        'yes-within-5y': 'q_target',
        someday: 'reply_someday',
        no: 'reply_no_plans',
      },
    },
    {
      kind: 'preference',
      id: 'q_target',
      version: 1,
      prompt: 'About how much would the down payment be, and by when?',
      answer: { kind: 'amount-month-year', maxDollars: 10_000_000 },
      valueSchema: HOUSE_TARGET_SCHEMA,
      storage: { kind: 'interview-answer' },
      branches: { '*': 'reply_house_plan' },
    },
    { kind: 'reply', id: 'reply_house_plan', compute: (ctx, answers) => housePlanReply(ctx, answers) },
    {
      kind: 'reply',
      id: 'reply_someday',
      compute: () => ({
        kind: 'info',
        lines: ['Nothing computed — you said a home purchase is someday, not within 5 years. This question comes back in 24 months.'],
      }),
    },
    {
      kind: 'reply',
      id: 'reply_no_plans',
      compute: () => ({
        kind: 'info',
        lines: ['Nothing computed — you said no home-purchase plans. This question comes back in 24 months.'],
      }),
    },
  ],
};
