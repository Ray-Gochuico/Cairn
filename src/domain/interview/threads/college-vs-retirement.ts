import { z } from 'zod';
import { formatCurrency } from '@/lib/format';
import { pickModerateRate } from '@/lib/growth-scenario';
import { includedAccountIds } from '@/lib/account-inclusion';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';
import { localTodayISO } from '@/lib/dates';
import { get529DeductionForState, UNLIMITED_DEDUCTION_SENTINEL } from '@/lib/529-state-deductions';
import { computeCollegeTarget, project529Real } from '@/lib/interview/college-tradeoff';
import { computeFiMonthlyDelta } from '@/lib/interview/effects';
import {
  getTuition, STATE_PUBLIC_4YR_TUITION_FEES, TUITION_BASE_ACADEMIC_YEAR,
  TUITION_REAL_GROWTH, TUITION_SECTOR_LABELS,
} from '@/data/tuition-reference';
import { AccountType } from '@/types/enums';
import { monthsBetweenIso } from '@/domain/interview/evaluate';
import type { Account, Dependent } from '@/types/schema';
import type { AnswerValues, InterviewContext, InterviewThread } from '@/types/interview';

/** D-T3-4: sector fixed this wave; a q_sector is a phase-3 chip. */
const SECTOR = 'PUBLIC_4YR_IN_STATE' as const;
const MONTHS_TO_18 = 216;

const FILING_LABELS = {
  SINGLE: 'single', MFJ: 'married filing jointly',
  MFS: 'married filing separately', HOH: 'head of household',
} as const;

/** The q_target_year stored value — T2's shipped compound arm (D-T3-9:
 *  no standalone month-year control exists in the frozen kernel, so the
 *  amount-month-year arm is reused; only targetMonth is ever read). */
interface CollegeTarget {
  amountDollars: number;
  /** 'YYYY-MM' — composed by the amount-month-year control. */
  targetMonth: string;
}

const COLLEGE_TARGET_SCHEMA = z.object({
  amountDollars: z.number().positive().max(50_000),
  targetMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const monthYearLabel = (ym: string): string =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const fmt = (n: number): string => formatCurrency(Math.round(n));

/** D-T3-15: the month the dependent turns 18, as 'YYYY-MM'. */
function eighteenthBirthdayMonth(dobIso: string): string {
  return `${Number(dobIso.slice(0, 4)) + 18}-${dobIso.slice(5, 7)}`;
}

/** D-T3-5: non-excluded 529 accounts only. */
function included529(ctx: InterviewContext): Account[] {
  const included = includedAccountIds(ctx.accounts);
  return ctx.accounts.filter(
    (a) => a.id != null && included.has(a.id) && a.type === AccountType.ACCOUNT_529,
  );
}

interface ResolvedStart {
  startYm: string;          // 'YYYY-MM'
  monthsToStart: number;    // >= 0
  usingName: string | null; // null on the entered-date path
  dependentCount: number;
}

/** D-T3-8: soonest-to-18 dependent (tie → lower id); no dependents → the
 *  stored q_target_year answer. Pure recompute (the vehicle-thread idiom).
 *  T2 f1 lesson: the LOCAL calendar day — toISOString reads the UTC day,
 *  which near month starts is the prior month for a local-midnight Date. */
function resolveStart(ctx: InterviewContext, answers: AnswerValues): ResolvedStart {
  const todayIso = localTodayISO(ctx.today);
  if (ctx.dependents.length > 0) {
    const ranked = ctx.dependents
      .map((d: Dependent) => ({
        d, months: Math.max(0, MONTHS_TO_18 - monthsBetweenIso(d.dateOfBirth, todayIso)),
      }))
      .sort((a, b) => a.months - b.months || (a.d.id ?? 0) - (b.d.id ?? 0));
    const pick = ranked[0];
    return {
      startYm: pick.months === 0 ? todayIso.slice(0, 7) : eighteenthBirthdayMonth(pick.d.dateOfBirth),
      monthsToStart: pick.months,
      usingName: pick.d.name,
      dependentCount: ctx.dependents.length,
    };
  }
  const target = answers.get('q_target_year') as CollegeTarget; // walked path guarantees it
  return {
    startYm: target.targetMonth,
    monthsToStart: Math.max(0, monthsBetweenIso(todayIso.slice(0, 7), target.targetMonth)),
    usingName: null,
    dependentCount: 0,
  };
}

function balance529(ctx: InterviewContext): number | null {
  const accts = included529(ctx);
  if (accts.length === 0) return null;
  const ids = new Set(accts.map((a) => a.id as number));
  return sumLatestOnOrBefore(ctx.snapshots, localTodayISO(ctx.today), ids);
}

/** CI-C14 / CI-C15 / CI-C16 — the deduction hint contract (D-T3-11). */
function deductionLine(ctx: InterviewContext): string {
  const st = ctx.household.state;
  const d = get529DeductionForState(st, ctx.household.filingStatus);
  if (d == null) return `No state deduction encoded for ${st}.`;
  if (d.maxAmount === UNLIMITED_DEDUCTION_SENTINEL) {
    return `${st} allows an unlimited 529 deduction — confirm with the state DOR.`;
  }
  return `${st} allows deducting up to ${formatCurrency(d.maxAmount)} of 529 contributions for ${FILING_LABELS[ctx.household.filingStatus]} filers — confirm with the state DOR.`;
}

interface TargetBits {
  start: ResolvedStart;
  targetDollars: number;
  targetLine: string;   // CI-C5
  basisLine: string;    // CI-C6
  pathAssumes: string[]; // CI-C19 | CI-C20 / CI-C21 / CI-C18 / CI-C23
  title: string;        // CI-C4
}

function targetBits(ctx: InterviewContext, answers: AnswerValues): TargetBits {
  const start = resolveStart(ctx, answers);
  const t = getTuition(SECTOR, ctx.household.state);
  const growth = TUITION_REAL_GROWTH[SECTOR];
  const targetDollars = computeCollegeTarget({
    annualTodayDollars: t.tuitionFees + t.housingFood,
    realGrowthPctPerYear: growth.pctPerYear,
    startMonthsAhead: start.monthsToStart,
  });
  const stateBasis = t.stateSpecific
    ? `${ctx.household.state} in-state tuition and fees` : 'national averages';
  const pathAssumes: string[] = [];
  if (start.usingName == null) {
    pathAssumes.push('Using your entered start date — no dependents are tracked in this app.');
  } else if (start.dependentCount > 1) {
    pathAssumes.push(`Using ${start.usingName} — the first to reach 18.`);
  }
  if (start.usingName != null && start.monthsToStart === 0) {
    pathAssumes.push(`${start.usingName} is 18 or older — using today's published prices.`);
  }
  if (!t.stateSpecific && Object.keys(STATE_PUBLIC_4YR_TUITION_FEES).length > 0) {
    pathAssumes.push(`No ${ctx.household.state} in-state figure encoded — using the national average.`);
  }
  if (t.stateSpecific) pathAssumes.push('Housing and food use the national average.');
  return {
    start,
    targetDollars,
    targetLine: `Four years at ${TUITION_SECTOR_LABELS[SECTOR]} starting ${monthYearLabel(start.startYm)}: ≈ ${fmt(targetDollars)} in today's dollars.`,
    basisLine: `Based on: published ${TUITION_BASE_ACADEMIC_YEAR} prices (${stateBasis}), grown ${Number(growth.pctPerYear.toFixed(2))}% a year above inflation.`,
    pathAssumes,
    title: start.usingName == null ? 'College plan' : `College for ${start.usingName}`,
  };
}

const VINTAGE_FOOTER = `Published ${TUITION_BASE_ACADEMIC_YEAR} prices — verify with the school.`; // CI-C17

function tradeoffReply(ctx: InterviewContext, answers: AnswerValues) {
  const bits = targetBits(ctx, answers);
  const monthly = answers.get('q_monthly_amount') as number;
  const balance = balance529(ctx);
  const startLabel = monthYearLabel(bits.start.startYm);
  const fv = project529Real({
    balanceTodayDollars: balance ?? 0,
    monthlyDollars: monthly,
    months: bits.start.monthsToStart,
    nominalAnnualRate: pickModerateRate(ctx.household),
    annualInflation: ctx.household.inflationAssumption,
  });
  const lines = [
    bits.targetLine,
    balance == null
      ? `No balance snapshot for the 529 yet — ${formatCurrency(monthly)}/mo alone grows to ≈ ${fmt(fv)} by ${startLabel} — moderate scenario, inflation-adjusted.`
      : `${formatCurrency(balance)} across 529 accounts plus ${formatCurrency(monthly)}/mo grows to ≈ ${fmt(fv)} by ${startLabel} — moderate scenario, inflation-adjusted.`,
  ];
  const gap = Math.round(bits.targetDollars - fv);
  lines.push(
    gap > 0 ? `About ${fmt(gap)} short of the target at this pace.`
      : gap < 0 ? `About ${fmt(-gap)} past the target at this pace.`
        : 'On the target at this pace.',
  );
  const fi = computeFiMonthlyDelta(ctx, monthly);
  lines.push(
    fi.kind === 'delta'
      ? `The same ${formatCurrency(monthly)}/mo toward retirement instead: ≈ ${fi.years.toFixed(1)} years sooner to your FI target — two identical projections, one with this monthly amount added.`
      : fi.kind === 'fi-unreachable'
        ? "FI target not reachable under the moderate scenario — the retirement side isn't shown."
        : 'The retirement side needs a monthly expense baseline and withdrawal rate — not shown.',
  );
  return {
    kind: 'plan' as const,
    title: bits.title,
    lines,
    assumes: [
      bits.basisLine,
      'These dollars count toward exactly one side.',
      "529 balances aren't counted in the FI target — education-earmarked.",
      deductionLine(ctx),
      ...bits.pathAssumes,
      VINTAGE_FOOTER,
    ],
  };
}

function tuitionOnlyReply(ctx: InterviewContext, answers: AnswerValues) {
  const bits = targetBits(ctx, answers);
  return {
    kind: 'plan' as const,
    title: bits.title,
    lines: [
      bits.targetLine,
      'No 529 account is tracked in this app — nothing to project on the savings side.',
    ],
    assumes: [bits.basisLine, deductionLine(ctx), ...bits.pathAssumes, VINTAGE_FOOTER],
  };
}

/**
 * Thread 4 — college vs. retirement (Appendix A Wave T3; D-GI3 dataset).
 * Surfaces only with ≥1 dependent or ≥1 non-excluded 529 (D-T3-2).
 * Stable IDs forever: college_vs_retirement / d_dependents / q_target_year /
 * d_529 / q_monthly_amount / reply_tradeoff / reply_tuition_only.
 */
export const COLLEGE_VS_RETIREMENT_THREAD: InterviewThread = {
  id: 'college_vs_retirement',
  title: 'College vs. retirement',
  scope: 'household',
  entry: 'd_dependents',
  nodes: [
    {
      kind: 'data-branch',
      id: 'd_dependents',
      evaluate: (ctx) => {
        const count529 = included529(ctx).length;
        if (ctx.dependents.length === 0) {
          return count529 > 0
            ? { branch: 'no-dependents-529', facts: { dependentCount: 0, count529 } }
            : { branch: 'none', facts: { dependentCount: 0, count529 } };
        }
        const start = resolveStart(ctx, new Map());
        return {
          branch: 'dependents',
          facts: {
            dependentCount: start.dependentCount, usingName: start.usingName,
            startYm: start.startYm, monthsToStart: start.monthsToStart,
          },
        };
      },
      branches: { dependents: 'd_529', 'no-dependents-529': 'q_target_year', none: null },
    },
    {
      kind: 'preference',
      id: 'q_target_year',
      version: 1,
      prompt: 'When would college costs start?',
      // D-T3-9 as-shipped: T2's compound amount-month-year arm (the kernel's
      // only month-year control; AnswerSpec is frozen). The control forces an
      // amount; the thread reads ONLY targetMonth — the amount is stored but
      // never rendered and never used (chip: standalone month-year arm).
      answer: { kind: 'amount-month-year', maxDollars: 50_000 },
      valueSchema: COLLEGE_TARGET_SCHEMA,
      staleAfterMonths: 24,
      storage: { kind: 'interview-answer' },
      branches: { '*': 'd_529' },
    },
    {
      kind: 'data-branch',
      id: 'd_529',
      evaluate: (ctx) => {
        const accts = included529(ctx);
        if (accts.length === 0) return { branch: 'no-529', facts: { accountCount: 0 } };
        const balance = balance529(ctx);
        return {
          branch: 'has-529',
          facts: { accountCount: accts.length, hasSnapshot: balance != null },
        };
      },
      branches: { 'has-529': 'q_monthly_amount', 'no-529': 'reply_tuition_only' },
    },
    {
      kind: 'preference',
      id: 'q_monthly_amount',
      version: 1,
      prompt: 'About how much goes toward college savings each month?',
      answer: { kind: 'amount', maxDollars: 50_000 },
      valueSchema: z.number().positive().max(50_000),
      staleAfterMonths: 12,
      storage: { kind: 'interview-answer' },
      branches: { '*': 'reply_tradeoff' },
    },
    { kind: 'reply', id: 'reply_tradeoff', compute: (ctx, answers) => tradeoffReply(ctx, answers) },
    { kind: 'reply', id: 'reply_tuition_only', compute: (ctx, answers) => tuitionOnlyReply(ctx, answers) },
  ],
};
