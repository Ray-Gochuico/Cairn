import { FRAMEWORKS } from '@/domain/interview/frameworks';
import { allocateContribution } from '@/lib/contribution-allocator';
import { valueHoldings } from '@/lib/holdings-value';
import { buildScenarioDefaults } from '@/lib/calculators/scenario-assumptions';
import { formatCurrency } from '@/lib/format';
import { ASSET_CLASS_LABEL } from '@/lib/asset-class-labels';
import type { AssetClass } from '@/types/enums';
import type { InterviewContext } from '@/types/interview';
import { splitAmount, type BucketId, type FrameworkSplit, type SplitInput } from './waterfall';
import { computeEffect } from './effects';

export interface CardRow { label: string; amount: string; forLabel?: string }
export interface CardPhase { label: 'First' | 'Then' | 'Ongoing'; rows: CardRow[] }
export interface AssumeRow {
  group: 'provenance' | 'constants' | 'skipped';
  text: string;
  /** Rendered as a router Link after the text (CI-11's Open Household →). */
  cta?: { label: string; to: string };
}

export interface FrameworkCardModel {
  policyId: string;
  title: string;      // CI-4
  cadence: 'one-time' | 'per-month';
  rows: CardRow[];    // one-time table
  phases: CardPhase[]; // per-month table (≤ 3 after collapse)
  headline: string;
  secondaries: string[];
  assumes: AssumeRow[];
  footer: string;     // CI-5, fixed
  /** CI-26: render the inline jobStability DecisionPrompt for this person. */
  askJobStability: { personId: number; name: string } | null;
}

export const CARD_FOOTER =
  'One mechanical framework applied to your numbers — not advice, not a recommendation.';

function bucketLabel(bucket: BucketId, split: FrameworkSplit, ctx: InterviewContext): string {
  const { low, high } = ctx.thresholds;
  switch (bucket) {
    case 'ef_floor': return 'Emergency fund — to 1× expenses';
    case 'match': return 'Employer match';
    case 'high_rate_debt': return `High-rate debt (≥ ${high}%)`;
    case 'ef_target': return `Emergency fund — to ${split.efMultiple}× expenses`;
    case 'mid_rate_debt': return `Debt in the ${low}–${high}% band`;
    case 'invest': return 'Invest';
  }
}

/** CB-9 collector policy (D-WA12), extracted for direct pinning (review
 *  MAJOR: the fixture-shaped suites let a first-seen mutant survive —
 *  one-time is single-invocation and the equal-phase per-month fixture
 *  never disagrees across phases). Keep the MAX need per class across a
 *  card's investRows invocations: investRows runs once per per-month
 *  phase, and the max is the steady-state (Ongoing) figure. */
export function recordUnallocatableMax(
  collector: Map<AssetClass, number>,
  classes: ReadonlyArray<{ assetClass: AssetClass; need: number }>,
): void {
  for (const u of classes) {
    const prev = collector.get(u.assetClass) ?? 0;
    if (u.need > prev) collector.set(u.assetClass, u.need);
  }
}

/** Per-class Invest rows via the allocator when targets exist (§3.1 B6). */
function investRows(
  investCents: number,
  ctx: InterviewContext,
  assumes: AssumeRow[],
  unallocatable: Map<AssetClass, number>,
): CardRow[] {
  const targets = ctx.settings?.assetClassTargetAllocations ?? null;
  const amount = formatCurrency(investCents / 100);
  if (targets == null || targets.length === 0 || investCents === 0) {
    if (investCents > 0) {
      assumes.push({ group: 'skipped', text: 'No target allocation set — shown as one investing amount.' });
    }
    return investCents > 0 ? [{ label: 'Invest', amount }] : [];
  }
  // The ContributionAllocatorCard wiring (:130-156) as plain maps:
  const assetClassByTicker = new Map<string, AssetClass>();
  for (const t of ctx.tickers) assetClassByTicker.set(t.ticker, t.assetClass);
  const latestDateByAccount = new Map<number, string>();
  const latestPerAccount = new Map<number, number>();
  for (const s of ctx.snapshots) {
    // latest snapshot value per account (ISO strings sort as dates do)
    const prev = latestDateByAccount.get(s.accountId);
    if (prev == null || s.snapshotDate > prev) {
      latestDateByAccount.set(s.accountId, s.snapshotDate);
      latestPerAccount.set(s.accountId, s.totalValue);
    }
  }
  const valuations = valueHoldings(ctx.accounts, ctx.holdings, latestPerAccount, assetClassByTicker);
  const householdTotal = valuations.reduce((a, v) => a + v.value, 0);
  const result = allocateContribution({ valuations, classTargets: targets, householdTotal, cash: investCents / 100 });
  assumes.push({
    group: 'provenance',
    text: 'Account values come from your latest snapshots, spread across holdings by share count — not live prices.',
  });
  // CB-9 (extends CI-21): record each class's dead-end dollars — max-wins
  // across this card's invocations, emitted once after all of them (D-WA12;
  // policy extracted above so the max rule is pinned directly).
  recordUnallocatableMax(unallocatable, result.unallocatableClasses);
  // One 'Invest — {class}' row per FUNDED class (result.rows is per-ticker
  // {ticker, assetClass, buyDollars} — aggregate by class), plus the exact
  // cashLeftOver row. Dollars only; labels via the house ASSET_CLASS_LABEL
  // map ("one map, one spelling") — review M2: raw enum strings never render.
  const byClass = new Map<AssetClass, number>();
  for (const r of result.rows) {
    if (r.buyDollars > 0) byClass.set(r.assetClass, (byClass.get(r.assetClass) ?? 0) + r.buyDollars);
  }
  const out: CardRow[] = [...byClass.entries()].map(([cls, dollars]) => ({
    label: `Invest — ${ASSET_CLASS_LABEL[cls]}`,
    amount: formatCurrency(dollars),
  }));
  if (result.cashLeftOver > 0) {
    out.push({ label: 'Invest — unallocated cash', amount: formatCurrency(result.cashLeftOver) });
  }
  return out;
}

export function buildFrameworkCards(input: SplitInput, ctx: InterviewContext): FrameworkCardModel[] {
  return FRAMEWORKS.map((policy) => {
    const split = splitAmount(input, policy.id, ctx);
    const effect = computeEffect(split, ctx);
    const assumes: AssumeRow[] = [];
    const unallocatable = new Map<AssetClass, number>();
    // (a) provenance — only when a projection figure rendered (CI-22 + CI-26b)
    if (effect.usedProjection) {
      const todayIso = ctx.today.toISOString().slice(0, 10);
      const { defaults, provenance } = buildScenarioDefaults({
        household: ctx.household, settings: ctx.settings, accounts: ctx.accounts,
        snapshots: ctx.snapshots, contributions: ctx.contributions, todayIso,
      });
      assumes.push({
        group: 'provenance',
        text: `Growth: ${defaults.returnPct}% nominal (your moderate scenario), solved against ${defaults.inflationPct}% inflation in today's dollars — not a prediction.`,
      });
      assumes.push({ group: 'provenance', text: `Portfolio: ${provenance.portfolio}.` });
      assumes.push({ group: 'provenance', text: `Contributions: ${provenance.annualContribution}.` });
    }
    // (b) constants
    const overridden = ctx.household.interestThresholdLowPct != null || ctx.household.interestThresholdHighPct != null;
    assumes.push({
      group: 'constants',
      text: `Debt bands: ${ctx.thresholds.low}% and ${ctx.thresholds.high}% — ${overridden ? 'your Settings override' : 'app defaults'}.`,
    });
    // Review m1: judge funded-ness across EVERY phase — split.rows is only
    // phase 1 for per-month, and a multi-loan band commonly funds after EF.
    const fundedRows = split.cadence === 'one-time'
      ? split.rows
      : split.phases.flatMap((p) => p.rows);
    if ((split.gaps.highLoans.length > 1 && fundedRows.some((r) => r.bucket === 'high_rate_debt'))
      || (split.gaps.midLoans.length > 1 && fundedRows.some((r) => r.bucket === 'mid_rate_debt'))) {
      assumes.push({
        group: 'constants',
        text: 'Multiple loans pay highest rate first; rate ties go to the smaller balance, then the lower ID.',
      });
    }
    if (split.efAssumed) {
      assumes.push({
        group: 'constants',
        text: 'Assumes a 6× expense reserve — no job-stability answer on file. Answer below to use 3×.',
      });
    }
    // (c) skipped — verbatim from the waterfall (cta rides along, CI-11)
    for (const k of split.skipped) assumes.push({ group: 'skipped', text: k.reason, cta: k.cta });

    // Table rows (invest rows may expand per class + push assume rows)
    const toRows = (rows: FrameworkSplit['rows']): CardRow[] =>
      rows.flatMap((r) => r.bucket === 'invest'
        ? investRows(r.amountCents, ctx, assumes, unallocatable)
        : [{ label: bucketLabel(r.bucket, split, ctx), amount: formatCurrency(r.amountCents / 100) }]);

    const phases: CardPhase[] = split.cadence === 'per-month'
      ? collapsePhases(split, toRows)
      : [];

    const unansweredJs = split.efAssumed
      ? ctx.persons.find((p) => p.jobStability == null) ?? null
      : null;

    const rows = toRows(split.rows);
    // CB-9: one row per unallocatable class, dollars attached. `need` is
    // already DOLLARS (allocateContribution is fed investCents / 100);
    // per-month cards carry the card's own $/mo unit.
    const perMonthSuffix = split.cadence === 'per-month' ? '/mo' : '';
    for (const [cls, need] of unallocatable) {
      assumes.push({
        group: 'skipped',
        text: `No held fund for ${ASSET_CLASS_LABEL[cls]} — ${formatCurrency(need)}${perMonthSuffix} stays as unallocated cash.`,
      });
    }
    // investRows pushes its assume rows on every toRows call (once per
    // per-month phase + once for the model rows) — dedupe by text, keeping
    // first occurrence so group order is stable.
    const dedupedAssumes = assumes.filter(
      (a, i) => assumes.findIndex((b) => b.text === a.text) === i,
    );

    return {
      policyId: policy.id,
      title: `${policy.name} — "${policy.epithet}"`,
      cadence: split.cadence,
      rows,
      phases,
      headline: effect.headline,
      secondaries: effect.secondaries,
      assumes: dedupedAssumes,
      footer: CARD_FOOTER,
      askJobStability: unansweredJs && unansweredJs.id != null
        ? { personId: unansweredJs.id, name: unansweredJs.name }
        : null,
    };
  });
}

/** ≤3 display phases: First / (merged) Then / Ongoing, with CI-8 For labels. */
function collapsePhases(
  split: FrameworkSplit,
  toRows: (rows: FrameworkSplit['rows']) => CardRow[],
): CardPhase[] {
  const withFor = (rows: FrameworkSplit['rows'], months: number | null): CardRow[] =>
    toRows(rows).map((row) => ({
      ...row,
      forLabel: row.label === 'Employer match' ? 'through December'
        : months == null ? (row.label.startsWith('Invest') ? 'ongoing' : 'until paid off')
          : `≈ ${months} month${months === 1 ? '' : 's'}`,
    }));
  const ps = split.phases;
  if (ps.length <= 3) {
    return ps.map((p, i) => ({
      label: i === 0 ? 'First' : i === ps.length - 1 ? 'Ongoing' : 'Then',
      rows: withFor(p.rows, p.months),
    }));
  }
  // Deeper schedules: first + ONE merged 'Then' (each middle phase's rows
  // concatenated, keeping per-phase For labels) + ongoing.
  const middles = ps.slice(1, -1);
  return [
    { label: 'First', rows: withFor(ps[0].rows, ps[0].months) },
    { label: 'Then', rows: middles.flatMap((p) => withFor(p.rows, p.months)) },
    { label: 'Ongoing', rows: withFor(ps[ps.length - 1].rows, ps[ps.length - 1].months) },
  ];
}
