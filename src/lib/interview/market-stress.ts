import {
  computeStressDelays, isFoundVerdict, type StressWindowNumerics,
} from '@/lib/backtest/stress-delay';
import { MAX_SOLVE_AGE } from '@/lib/calculators/retirement-age-solver';
import { TODAY_PHRASE } from '@/lib/calculators/basis-vocabulary';
import { includedAccountIds } from '@/lib/account-inclusion';
import { currentAgeAsOf } from '@/lib/dates';
import { formatCurrency, formatPercent } from '@/lib/format';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';
import { AccountType } from '@/types/enums';
import type { InterviewContext } from '@/types/interview';
import { kernelScenario } from './effects';
import { todayIsoOf, utcNoonOf } from './kernel-dates';

export type { StressWindowNumerics } from '@/lib/backtest/stress-delay';

/**
 * R4 (D-R4-4/5/6): the market_stress thread's compute — an ADAPTER over the
 * SHARED solve (src/lib/backtest/stress-delay.ts, coordinator ruling
 * 2026-09-24): it gathers the kernel's inputs (kernelScenario — the kernel's
 * one rate seam; the OLDER person's local-day age through utcNoonOf) and owns
 * every string. Pure over ctx + the bundled dataset — no converter, no
 * storage, no clock. The numerics come back as a data seam (window-end start,
 * flatPathEnd cadence, per-window verdicts), pinned independently in the
 * shared module's suite and again through the seeded strings here.
 */

export const MIX_OPTIONS = [
  { value: 'stocks-100', label: 'All stocks', stockPct: 100 },
  { value: 'stocks-75', label: '75% stocks, 25% bonds', stockPct: 75 },
  { value: 'stocks-60', label: '60% stocks, 40% bonds', stockPct: 60 },
  { value: 'stocks-40', label: '40% stocks, 60% bonds', stockPct: 40 },
] as const;
export type MixKey = (typeof MIX_OPTIONS)[number]['value'];
export const MIX_KEYS = MIX_OPTIONS.map((o) => o.value) as [MixKey, ...MixKey[]];

/** ⚑ R4-F16 (D-R4-P3): the thread SURFACES on invested balances only —
 *  brokerage and retirement accounts. A checking-only household is not asked
 *  its stock/bond split. The REPLAYED balance is still the FI-eligible sum
 *  (kernelScenario — the Stress Test card's prefill rule), stated on the card. */
export const INVESTED_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  AccountType.ACCOUNT_401K, AccountType.ACCOUNT_ROTH_401K, AccountType.ACCOUNT_ROTH_IRA,
  AccountType.ACCOUNT_TRAD_IRA, AccountType.ACCOUNT_BROKERAGE,
]);

export function investedBalance(ctx: InterviewContext): number {
  const included = includedAccountIds(ctx.accounts);
  const ids = new Set<number>();
  for (const a of ctx.accounts) {
    if (a.id != null && included.has(a.id) && INVESTED_ACCOUNT_TYPES.has(a.type)) ids.add(a.id);
  }
  if (ids.size === 0) return 0;
  return sumLatestOnOrBefore(ctx.snapshots, todayIsoOf(ctx), ids) ?? 0;
}

/** The shared solver's state in the kernel's vocabulary (no-target → no-baseline; no-age → no-persons). */
export type FiState = 'ok' | 'no-baseline' | 'no-persons' | 'past-max-today' | 'never-real' | 'not-by-max';

export interface MarketStressResult {
  stockPct: number;
  bondPct: number;
  pv: number;
  pmt: number;
  returnPct: number;
  inflationPct: number;
  realRate: number;
  swrPct: number;
  monthlyExpenses: number;
  /** D-R4-P5 (⚑ R4-P-EXP): the FI target's expense basis — the household baseline, named in the cards' vocabulary. */
  expenseSource: 'household';
  targetFv: number | null;
  ageNow: number | null;
  olderName: string | null;
  personCount: number;
  fiState: FiState;
  /** True when both legs were solved (a target, a person, and an age below the cap). */
  solverRan: boolean;
  lastDataYear: number;
  provenance: { portfolio: string; annualContribution: string };
  windows: StressWindowNumerics[];
}

export function computeMarketStress(ctx: InterviewContext, mix: MixKey): MarketStressResult {
  const stockPct = MIX_OPTIONS.find((o) => o.value === mix)!.stockPct;
  const { defaults, provenance, realRate, todayIso } = kernelScenario(ctx);
  const pv = defaults.portfolio;
  const pmt = defaults.annualContribution;
  const fiComputable = defaults.monthlyExpenses > 0 && defaults.swrPct > 0;
  const targetFv = fiComputable ? (defaults.monthlyExpenses * 12) / (defaults.swrPct / 100) : null;
  // U12: the LOCAL-day age through the one bridge; the OLDER person caps the search (the card's two-person rule).
  const ages = ctx.persons.map((p) => ({ name: p.name, age: currentAgeAsOf(p.dateOfBirth, utcNoonOf(todayIso)) }));
  const older = ages.reduce<{ name: string; age: number } | null>((best, a) => (best == null || a.age > best.age ? a : best), null);
  const d = computeStressDelays({ pv, pmt, realRate, targetFv, ageNow: older?.age ?? null, stockPct: stockPct / 100 });
  const fiState: FiState = d.solverState === 'no-target' ? 'no-baseline' : d.solverState === 'no-age' ? 'no-persons' : d.solverState;
  return {
    stockPct, bondPct: 100 - stockPct, pv, pmt,
    returnPct: defaults.returnPct, inflationPct: defaults.inflationPct, realRate,
    swrPct: defaults.swrPct, monthlyExpenses: defaults.monthlyExpenses, expenseSource: 'household',
    targetFv, ageNow: older?.age ?? null, olderName: older?.name ?? null, personCount: ages.length,
    fiState, solverRan: d.solverRan, lastDataYear: d.lastDataYear,
    provenance: { portfolio: provenance.portfolio, annualContribution: provenance.annualContribution },
    windows: d.windows,
  };
}

// ── Line builders (pure over the numerics; every string of the copy contract) ──

const fmt = (n: number): string => formatCurrency(Math.round(n));
/** The Stress card's signedPct register (U+2212), re-derived — never imported from a page. */
const pct = (f: number): string => `${f < 0 ? '−' : '+'}${Math.abs(f * 100).toFixed(1)}%`;
const years = (s: { startYear: number; endYear: number }): string =>
  s.startYear === s.endYear ? `${s.startYear}` : `${s.startYear}–${s.endYear}`;
const AGE = MAX_SOLVE_AGE;
/** ⚑ R4-P-EXP (D-R4-P5): the expense source in the framework cards' vocabulary.
 *  An override widens MarketStressResult['expenseSource'] and adds its phrase
 *  here (`from {n} months of spending`) — one line + the re-pins. */
const EXPENSE_SOURCE_PHRASE: Record<MarketStressResult['expenseSource'], string> = {
  household: 'from Household',
};

function fiClause(w: StressWindowNumerics, r: MarketStressResult): string {
  if (!r.solverRan) return '';
  if (w.solveAge >= AGE) return ` This window runs past age ${AGE} — no retirement reading here.`; // CI-MS-3g (per window)
  if (r.fiState !== 'ok') return ''; // the uniform rows (9b / 9e) speak for every line
  if (isFoundVerdict(w.verdictA)) {
    if (isFoundVerdict(w.verdictB) && w.delay != null) {
      if (w.delay === 0) return ' No change to the year your FI target holds.'; // CI-MS-3b
      const k = Math.abs(w.delay);
      const unit = k === 1 ? 'year' : 'years';
      return w.delay > 0
        ? ` FI target about ${k} ${unit} later than on your assumed path.` // CI-MS-3
        : ` FI target about ${k} ${unit} sooner than on your assumed path.`; // CI-MS-3c
    }
    if (w.verdictB === 'not-by-max') return ` FI target not reached by age ${AGE} on this path.`; // CI-MS-3d
    if (w.verdictB === 'never-real') return ' FI target not reached in real terms on this path.'; // CI-MS-3f
    return '';
  }
  return ` FI target not reached by age ${AGE} on your assumed path from this window's end.`; // CI-MS-3e (mixed)
}

function windowLine(w: StressWindowNumerics, r: MarketStressResult): string {
  const rec = w.recoveredYear == null
    ? `; not back at today's value by ${r.lastDataYear}, where the bundled data ends.` // CI-MS-2c
    : r.pmt > 0
      ? `; back at today's value by ${w.recoveredYear} with your ${fmt(r.pmt)}/yr contributions counted.` // CI-MS-2r'
      : `; back at today's value by ${w.recoveredYear}.`; // CI-MS-2r
  const fi = fiClause(w, r);
  if (w.outpaced) {
    return `${w.label} (${years(w.span)}): never below today's value at a year-end — contributions outpaced this window's losses; ${fmt(w.windowEndBalance)} at the end of the window.${fi}`; // CI-MS-2d
  }
  if (w.troughYear === w.span.endYear) {
    return `${w.label} (${years(w.span)}): ${fmt(w.troughBalance)} at the deepest year-end, ${pct(w.depth)} from today${rec}${fi}`; // CI-MS-2
  }
  return `${w.label} (${years(w.span)}): ${fmt(w.troughBalance)} at the deepest year-end (${w.troughYear}), ${pct(w.depth)} from today, and ${fmt(w.windowEndBalance)} at the end of ${w.span.endYear}${rec}${fi}`; // CI-MS-2b
}

export function renderMarketStress(r: MarketStressResult): { title: string; lines: string[]; assumes: string[] } {
  const mixText = `${r.stockPct}% stocks / ${r.bondPct}% bonds`;
  const basis = r.pmt > 0
    ? `Your ${fmt(r.pv)} portfolio and ${fmt(r.pmt)}/yr of contributions — from your latest account snapshots and the last 12 months of contributions — replayed through five historical windows at a ${mixText} mix, ${TODAY_PHRASE}.` // CI-MS-1c
    : `Your ${fmt(r.pv)} portfolio — from your latest account snapshots — replayed through five historical windows at a ${mixText} mix, ${TODAY_PHRASE}.`; // CI-MS-1
  const lines = [basis, ...r.windows.map((w) => windowLine(w, r))];

  const assumes: string[] = [
    'History that happened once — not a forecast, not a probability.', // CI-MS-4 (the card's CP-20)
    `Stock leg: Shiller's CPI-deflated S&P total return; bond leg: 10-year Treasury total return deflated to real. ${r.stockPct}% / ${r.bondPct}% mix, rebalanced annually — the same return basis as the Historical Backtest.`, // CI-MS-5
    "All figures in today's dollars — each window's inflation is already taken out. Measured at year-ends; the worst moments within a year were deeper.", // CI-MS-6
  ];
  // CI-MS-12 (ruling 4) iff ≥ 1 window carries a delay-family clause (3/3b/3c/3d/3e/3f) — never for the per-window past-max clause alone.
  const anyDelayClause = r.windows.some((w) => { const c = fiClause(w, r); return c !== '' && !c.startsWith(' This window runs past age'); });
  if (anyDelayClause) {
    // CI-MS-12 (ruling 4): the two clauses rest on different post-window tails.
    assumes.push('Two different tails: the "back at today\'s value" year follows the actual history after each window, while the FI reading resumes your assumed path from the window\'s last year and never replays those later years.');
  }
  if (r.solverRan && r.targetFv != null) {
    assumes.push(`Your assumed path compounds your ${formatPercent(r.returnPct / 100)} moderate scenario ≈ ${formatPercent(r.realRate)} real with the same contribution basis.`); // CI-MS-7
    const target = `FI target ${fmt(r.targetFv)} = 12 × ${fmt(r.monthlyExpenses)}/mo (${EXPENSE_SOURCE_PHRASE[r.expenseSource]}) ÷ ${formatPercent(r.swrPct / 100)} SWR — two identical whole-year solves from each window's last year, one from the replayed balance and one from your assumed path's balance`;
    assumes.push(r.personCount >= 2
      ? `${target}; the search ends where ${r.olderName} reaches ${AGE}, counting from today's age.` // CI-MS-8b
      : `${target}; the search ends at age ${AGE}, counting from today's age.`); // CI-MS-8
  }
  switch (r.fiState) { // the CI-MS-9 family — at most one row
    case 'no-baseline': assumes.push('The retirement side needs a monthly expense baseline and withdrawal rate — not shown.'); break;
    case 'never-real': assumes.push("FI target not reachable under the moderate scenario — the retirement side isn't shown."); break;
    case 'no-persons': assumes.push("The retirement reading needs a person's date of birth — not shown."); break;
    case 'past-max-today': assumes.push(`Past age ${AGE} — the retirement reading has no search range.`); break;
    case 'not-by-max': assumes.push(`The FI target doesn't hold by age ${AGE} on your assumed path — the retirement reading isn't shown.`); break;
    case 'ok': break;
  }
  assumes.push(`Portfolio: ${r.provenance.portfolio}.`, `Contributions: ${r.provenance.annualContribution}.`); // CI-MS-10
  assumes.push('Every start year, not just these windows — the Stress Test card and the Backtest tool on Calculators.'); // CI-MS-11
  return { title: 'Market stress', lines, assumes };
}
