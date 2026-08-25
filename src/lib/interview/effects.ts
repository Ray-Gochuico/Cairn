import { buildScenarioDefaults } from '@/lib/calculators/scenario-assumptions';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { compoundInterestSeries, toRealSummary } from '@/lib/compound-interest';
import { compareStrategies } from '@/lib/debt-payoff-comparison';
import { formatCurrency } from '@/lib/format';
import type { InterviewContext } from '@/types/interview';
import type { Loan } from '@/types/schema';
import { computeMatchSummary } from './match-value';
import type { BucketId, FrameworkSplit, SplitRow } from './waterfall';

export interface EffectResult {
  headline: string;
  secondaries: string[];
  /** True when any FI/projection figure rendered → CI-22 provenance rows. */
  usedProjection: boolean;
}

const BUCKET_ORDER: BucketId[] = ['ef_floor', 'match', 'high_rate_debt', 'ef_target', 'mid_rate_debt', 'invest'];

const fmtPct = (fraction: number): string => {
  const n = Number((fraction * 100).toFixed(2));
  return `${n}%`;
};
const monthYear = (d: Date): string =>
  d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const addMonths = (today: Date, months: number): Date => {
  const d = new Date(today.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

/** D-GI9: one-time → largest allocated share (ties → earlier bucket); per-month → largest row of phase 1. */
export function pickHeadlineBucket(split: FrameworkSplit): BucketId | null {
  const rows: SplitRow[] = split.cadence === 'one-time' ? split.rows : (split.phases[0]?.rows ?? []);
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const r of rows) {
    if (r.amountCents > best.amountCents) best = r;
    // ties keep the earlier row — rows are emitted in bucket order.
  }
  return best.bucket;
}

function baselinePhrase(source: 'transactions' | 'household' | 'none'): string {
  return source === 'transactions' ? '12-month spending baseline' : 'entered monthly baseline';
}

function efLine(split: FrameworkSplit, ctx: InterviewContext, allocCents: number): string | null {
  const g = split.gaps;
  const basis = `based on ${formatCurrency(g.reserveDollars)} across cash and savings accounts and your ${baselinePhrase(g.baselineSource)}`;
  if (split.cadence === 'one-time') {
    const before = (g.reserveDollars / g.baselineDollars).toFixed(1);
    const after = ((g.reserveDollars + allocCents / 100) / g.baselineDollars).toFixed(1);
    return `Your cash reserve would cover ${after} months of expenses, up from ${before} — ${basis}.`;
  }
  // Review M1: "fully funded" means the end of the LAST EF phase (a low
  // reserve emits ef_floor AND ef_target phases), and every phase at or
  // before it must have concrete months — an unbounded (capped-debt)
  // predecessor makes any date a fabrication, so the line is omitted
  // entirely (the CI-30 suppression ethos; no new copy).
  let lastEfIdx = -1;
  split.phases.forEach((p, i) => {
    if (p.rows.some((r) => r.bucket === 'ef_floor' || r.bucket === 'ef_target')) lastEfIdx = i;
  });
  if (lastEfIdx === -1) return null;
  let cumulative = 0;
  for (let i = 0; i <= lastEfIdx; i += 1) {
    const m = split.phases[i].months;
    if (m == null) return null;
    cumulative += m;
  }
  return `Emergency fund fully funded by ${monthYear(addMonths(ctx.today, cumulative))} at this pace — ${basis}.`;
}

function matchLine(ctx: InterviewContext): string {
  // Recompute is cheap and pure; the split carries no match detail rows.
  const m = computeMatchSummary(ctx);
  const value = formatCurrency(m.annualMatchValueDollars);
  if (m.accounts.length === 1) {
    const a = m.accounts[0];
    return `Captures the full employer match on ${a.ownerName}'s ${a.accountName} — worth about ${value} this year.`;
  }
  return `Captures the full employer match — worth about ${value} this year.`;
}

function oneTimeDebtLine(loans: Loan[], allocCents: number): string {
  // D-GI10: balance-delta statement only; spill described for the next loan.
  const first = loans[0];
  const firstPay = Math.min(allocCents / 100, first.currentBalance);
  const after = first.currentBalance - firstPay;
  let line = `Pays ${first.name} from ${formatCurrency(first.currentBalance)} down to ${formatCurrency(after)} — highest rate first (${fmtPct(first.interestRate)}).`;
  const spill = allocCents / 100 - firstPay;
  if (spill > 0 && loans[1]) {
    line += ` …then ${formatCurrency(spill)} toward ${loans[1].name}.`;
  }
  return line;
}

function perMonthDebtLine(
  loans: Loan[],
  extraCents: number,
  ctx: InterviewContext,
  band: 'high' | 'mid',
): string {
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const cmp = compareStrategies(loans, extraCents / 100, todayIso);
  const a = cmp.avalanche;
  if (a.anyCapped || a.savingsCapped || a.payoffDate == null) {
    return "The stated payment can't amortize this balance — interest and payoff figures aren't shown.";
  }
  const bandDesc = band === 'high' ? `${ctx.thresholds.high}% or more` : `${ctx.thresholds.low}–${ctx.thresholds.high}%`;
  const n = loans.length;
  const payoff = monthYear(new Date(`${a.payoffDate}T12:00:00Z`));
  return `≈ ${formatCurrency(a.savedVsMinimums)} less interest and paid off ${payoff} — your ${n} ${n === 1 ? 'loan' : 'loans'} at ${bandDesc}, highest rate first, vs. minimum payments.`;
}

function investLine(split: FrameworkSplit, ctx: InterviewContext, investCents: number): string {
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const { defaults } = buildScenarioDefaults({
    household: ctx.household, settings: ctx.settings, accounts: ctx.accounts,
    snapshots: ctx.snapshots, contributions: ctx.contributions, todayIso,
  });
  const investDollars = investCents / 100;
  const isLump = split.cadence === 'one-time';
  const fiComputable = defaults.monthlyExpenses > 0 && defaults.swrPct > 0;
  if (fiComputable) {
    const targetFv = (defaults.monthlyExpenses * 12) / (defaults.swrPct / 100);
    const scenarios = [{ label: 'moderate', rate: defaults.returnPct / 100 }];
    const inflation = defaults.inflationPct / 100;
    const solve = (pv: number, pmt: number): number =>
      financialIndependenceSeries({ pv, annualContribution: pmt, targetFv, scenarios, inflation })[0].years;
    const base = solve(defaults.portfolio, defaults.annualContribution);
    const withX = isLump
      ? solve(defaults.portfolio + investDollars, defaults.annualContribution) // D-GI6
      : solve(defaults.portfolio, defaults.annualContribution + investDollars * 12);
    if (Number.isFinite(base) && Number.isFinite(withX)) {
      const delta = (base - withX).toFixed(1);
      return `≈ ${delta} years sooner to your FI target — two identical projections, one with this ${isLump ? 'lump sum' : 'monthly amount'} added.`;
    }
    return `FI target not reachable under the moderate scenario — showing a 10-year projection instead. ${tenYearReal(defaults.returnPct, defaults.inflationPct, investDollars, isLump)}`;
  }
  return tenYearReal(defaults.returnPct, defaults.inflationPct, investDollars, isLump);
}

function tenYearReal(returnPct: number, inflationPct: number, dollars: number, isLump: boolean): string {
  const input = {
    pv: isLump ? dollars : 0,
    monthlyContribution: isLump ? 0 : dollars,
    annualRate: returnPct / 100,
    years: 10,
    frequency: 'MONTHLY' as const,
  };
  const series = compoundInterestSeries(input);
  // ⚠ nominal-on-real bug class: the REAL summary, never the nominal final.
  const real = toRealSummary(input, series, inflationPct / 100);
  return `≈ ${formatCurrency(real.finalMid)} in today's dollars after 10 years — moderate scenario, inflation-adjusted.`;
}

/** All funded rows: the split itself (one-time) or EVERY phase (per-month —
 *  a bucket funded only in a later phase still gets its secondary line). */
function allFundedRows(split: FrameworkSplit): SplitRow[] {
  return split.cadence === 'one-time' ? split.rows : split.phases.flatMap((p) => p.rows);
}

/** One EF narrative per card: the ef_floor + ef_target cents combined. */
function efAllocCents(split: FrameworkSplit): number {
  return allFundedRows(split)
    .filter((r) => r.bucket === 'ef_floor' || r.bucket === 'ef_target')
    .reduce((a, r) => a + r.amountCents, 0);
}

function lineFor(bucket: BucketId, split: FrameworkSplit, ctx: InterviewContext): { text: string | null; projection: boolean } {
  const cents = allFundedRows(split).find((r) => r.bucket === bucket)?.amountCents ?? 0;
  switch (bucket) {
    case 'ef_floor':
    case 'ef_target':
      return { text: efLine(split, ctx, efAllocCents(split)), projection: false };
    case 'match':
      return { text: matchLine(ctx), projection: false };
    case 'high_rate_debt':
      return {
        text: split.cadence === 'one-time'
          ? oneTimeDebtLine(split.gaps.highLoans, cents)
          : perMonthDebtLine(split.gaps.highLoans, cents, ctx, 'high'),
        projection: false,
      };
    case 'mid_rate_debt':
      return {
        text: split.cadence === 'one-time'
          ? oneTimeDebtLine(split.gaps.midLoans, cents)
          : perMonthDebtLine(split.gaps.midLoans, cents, ctx, 'mid'),
        projection: false,
      };
    case 'invest':
      return { text: investLine(split, ctx, cents), projection: true };
  }
}

// ── Wave T3: standalone per-month FI two-solve (D-T3-16) ────────────────────
// Mirrors investLine's per-month recipe EXACTLY (same defaults, same target,
// same moderate-scenario solve — including its toISOString todayIso, which
// parity with the shipped line requires) without touching the shipped,
// review-hardened investLine. The parity test in effects.test.ts pins the
// two together — if investLine's recipe ever changes, that test fails and
// this function follows.
export type FiMonthlyDelta =
  | { kind: 'delta'; years: number }
  | { kind: 'fi-unreachable' }
  | { kind: 'not-computable' };

export function computeFiMonthlyDelta(ctx: InterviewContext, monthlyDollars: number): FiMonthlyDelta {
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const { defaults } = buildScenarioDefaults({
    household: ctx.household, settings: ctx.settings, accounts: ctx.accounts,
    snapshots: ctx.snapshots, contributions: ctx.contributions, todayIso,
  });
  if (!(defaults.monthlyExpenses > 0 && defaults.swrPct > 0)) return { kind: 'not-computable' };
  const targetFv = (defaults.monthlyExpenses * 12) / (defaults.swrPct / 100);
  const scenarios = [{ label: 'moderate', rate: defaults.returnPct / 100 }];
  const inflation = defaults.inflationPct / 100;
  const solve = (pv: number, pmt: number): number =>
    financialIndependenceSeries({ pv, annualContribution: pmt, targetFv, scenarios, inflation })[0].years;
  const base = solve(defaults.portfolio, defaults.annualContribution);
  const withX = solve(defaults.portfolio, defaults.annualContribution + monthlyDollars * 12);
  if (!Number.isFinite(base) || !Number.isFinite(withX)) return { kind: 'fi-unreachable' };
  return { kind: 'delta', years: base - withX };
}

/** §3.5: the largest-share bucket supplies the headline; other funded buckets one secondary each. */
export function computeEffect(split: FrameworkSplit, ctx: InterviewContext): EffectResult {
  const head = pickHeadlineBucket(split);
  if (head == null) {
    return { headline: '', secondaries: [], usedProjection: false };
  }
  const headLine = lineFor(head, split, ctx);
  // Secondaries: every OTHER funded bucket (any phase), deduped, in bucket
  // order; the EF pair collapses into one narrative (never two EF lines) —
  // when either ef bucket is the head, exclude BOTH from secondaries, and
  // efLine sums both ef rows' cents for the one-time delta.
  const efSiblings: BucketId[] =
    head === 'ef_floor' ? ['ef_target'] : head === 'ef_target' ? ['ef_floor'] : [];
  const funded = BUCKET_ORDER.filter(
    (b) => b !== head && !efSiblings.includes(b)
      && allFundedRows(split).some((r) => r.bucket === b && r.amountCents > 0),
  );
  // Dedupe by rendered text: both funded EF buckets share one combined
  // narrative, so the second collapses away here. A null line (M1: the
  // suppressed CI-28 date) contributes nothing — never an empty-string row.
  const seen = new Set<string>(headLine.text == null ? [] : [headLine.text]);
  const secondaries: string[] = [];
  let usedProjection = headLine.text == null ? false : headLine.projection;
  for (const b of funded) {
    const l = lineFor(b, split, ctx);
    if (l.text == null || seen.has(l.text)) continue;
    seen.add(l.text);
    secondaries.push(l.text);
    usedProjection = usedProjection || l.projection;
  }
  return { headline: headLine.text ?? '', secondaries, usedProjection };
}
