import { frameworkById, type FrameworkId } from '@/domain/interview/frameworks';
import { monthsBetweenIso } from '@/domain/interview/evaluate';
import { compareStrategies } from '@/lib/debt-payoff-comparison';
import type { Loan } from '@/types/schema';
import { computeBucketGaps, type BucketGaps } from './gaps';
import { computeMatchSummary } from './match-value';
import type { Cadence, InterviewContext } from '@/types/interview';

export type BucketId =
  | 'ef_floor' | 'match' | 'high_rate_debt' | 'ef_target' | 'mid_rate_debt' | 'invest';

export interface SplitRow { bucket: BucketId; amountCents: number }
export interface SkipEntry {
  bucket: BucketId;
  reason: string;
  /** CI-11 carries a CTA into the assumes region (review M3). */
  cta?: { label: string; to: string };
}
export interface SplitInput { amountCents: number; cadence: Cadence }
/** Per-month schedule step. months null = open-ended (ongoing / capped debt). */
export interface Phase { months: number | null; rows: SplitRow[] }

export interface FrameworkSplit {
  policyId: FrameworkId;
  cadence: Cadence;
  /** one-time: the split; per-month: the FIRST phase's rows. Zero rows never emitted. */
  rows: SplitRow[];
  /** per-month only; [] for one-time. */
  phases: Phase[];
  skipped: SkipEntry[];
  efMultiple: 3 | 6;
  efAssumed: boolean;
  /** Snapshot the effect layer reuses (avoids recomputing; part of determinism). */
  gaps: BucketGaps;
}

// ── Copy (contract CI-10 … CI-19) ───────────────────────────────────────────
const efCoveredReason = (reserve: number, baseline: number): string =>
  `Emergency fund already at ${(reserve / baseline).toFixed(1)}× monthly expenses — skipped.`;
const NO_BASELINE =
  "Can't size your emergency fund — no expense baseline yet. Set one in Household or import transactions.";
const MATCH_ONE_TIME =
  "Employer match is captured through payroll deferral — a lump sum can't buy it directly.";
const NO_LOANS = 'No loans on file.';
const noHighRate = (high: number): string => `No loans at or above ${high}%.`;
const noMidRate = (low: number, high: number): string => `No loans in the ${low}–${high}% band.`;
const aggressiveMinimums = (low: number, high: number): string =>
  `Debt between ${low}–${high}% stays at minimum payments in this framework.`;
const MATCH_UNKNOWN =
  'Employer match unknown — answer the match question on the Roadmap to include it.';
const NO_MATCH = 'No employer match on your retirement accounts.';

/**
 * Months to clear a band with `extraCentsPerMonth` of extra payment, from
 * compareStrategies' avalanche SCHEDULE (interest accrues — design §3.3
 * forbids naive division for debt). null when the schedule is capped
 * (honesty flags) — the phase renders "until paid off" with no date.
 */
export function debtPayoffMonths(
  loans: Loan[],
  extraCentsPerMonth: number,
  todayIso: string,
): number | null {
  if (loans.length === 0 || extraCentsPerMonth <= 0) return null;
  const cmp = compareStrategies(loans, extraCentsPerMonth / 100, todayIso);
  if (cmp.avalanche.anyCapped || cmp.avalanche.payoffDate == null) return null;
  return Math.max(1, monthsBetweenIso(todayIso, cmp.avalanche.payoffDate));
}

/**
 * THE waterfall (design §3): pure over (input, policyId, ctx), integer
 * cents throughout (D-GI11). Rows + nothing = input, exactly — every
 * policy terminates in the unbounded B6 sink. Skip reasons are part of
 * the output contract (they render in "What this assumes", group c).
 */
export function splitAmount(
  input: SplitInput,
  policyId: FrameworkId,
  ctx: InterviewContext,
): FrameworkSplit {
  const policy = frameworkById(policyId);
  const gaps = computeBucketGaps(ctx);
  const ef = policy.efMultiple(ctx.persons);
  const efTargetTotalCents = ef.multiple === 3 ? gaps.ef3GapCents : gaps.ef6GapCents;
  const { low, high } = ctx.thresholds;
  const noBaseline = gaps.baselineSource === 'none';
  const skipped: SkipEntry[] = [];

  const skipEf = (bucket: 'ef_floor' | 'ef_target'): void => {
    skipped.push({
      bucket,
      reason: noBaseline ? NO_BASELINE : efCoveredReason(gaps.reserveDollars, gaps.baselineDollars),
      // CI-11's contract includes the CTA link (review M3).
      ...(noBaseline ? { cta: { label: 'Open Household →', to: '/inputs/household' } } : {}),
    });
  };
  const skipDebt = (bucket: 'high_rate_debt' | 'mid_rate_debt'): void => {
    if (!gaps.anyLoans) skipped.push({ bucket, reason: NO_LOANS });
    else if (bucket === 'high_rate_debt') skipped.push({ bucket, reason: noHighRate(high) });
    else skipped.push({ bucket, reason: noMidRate(low, high) });
  };

  if (input.cadence === 'one-time') {
    let remaining = input.amountCents;
    const rows: SplitRow[] = [];
    const take = (bucket: BucketId, capCents: number | null): number => {
      const amount = capCents == null ? remaining : Math.min(remaining, capCents);
      if (amount > 0) {
        rows.push({ bucket, amountCents: amount });
        remaining -= amount;
      }
      return amount;
    };

    // B1 — EF floor
    if (noBaseline || gaps.efFloorGapCents === 0) skipEf('ef_floor');
    else take('ef_floor', gaps.efFloorGapCents);
    // B2 — mechanically unbuyable with a lump (CI-12)
    skipped.push({ bucket: 'match', reason: MATCH_ONE_TIME });
    // B3 — high-rate debt
    if (gaps.highLoans.length === 0) skipDebt('high_rate_debt');
    else take('high_rate_debt', gaps.highRateGapCents);
    // B4 — EF to the policy target, net of what B1 just filled
    const b1Alloc = rows.find((r) => r.bucket === 'ef_floor')?.amountCents ?? 0;
    const b4Gap = Math.max(0, efTargetTotalCents - b1Alloc);
    if (noBaseline || efTargetTotalCents === 0) skipEf('ef_target');
    else if (b4Gap === 0) {
      // Review m2: the target is covered by THIS split's floor fill (sub-floor
      // baselines) — the B1 row on the same card already shows the EF being
      // funded, so no skip row (a "covered by reserve" reason would be false).
    } else take('ef_target', b4Gap);
    // B5 — per policy
    if (gaps.midLoans.length === 0) skipDebt('mid_rate_debt');
    else if (policy.midRate === 'fill') take('mid_rate_debt', gaps.midRateGapCents);
    else if (policy.midRate === 'minimums') {
      skipped.push({ bucket: 'mid_rate_debt', reason: aggressiveMinimums(low, high) });
    } else {
      // Moderate: 50/50 of the post-B4 remainder; odd cent to the EARLIER
      // bucket (B5); capped at the gap, overflow to B6 (D-GI11).
      const half = Math.floor(remaining / 2) + (remaining % 2);
      take('mid_rate_debt', Math.min(half, gaps.midRateGapCents));
    }
    // B6 — unbounded terminal sink: every dollar lands somewhere
    take('invest', null);

    return {
      policyId, cadence: 'one-time', rows, phases: [], skipped,
      efMultiple: ef.multiple, efAssumed: ef.assumed && policy.id === 'moderate', gaps,
    };
  }

  // ── per-month: phase schedule (design §3.3) ───────────────────────────────
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const match = computeMatchSummary(ctx);
  let matchCarve = 0;
  if (match.state === 'active') {
    matchCarve = Math.min(input.amountCents, match.runRateCentsPerMonth);
    for (const e of match.excluded) skipped.push({ bucket: 'match', reason: e.reason });
  } else if (match.state === 'unknown') {
    skipped.push({ bucket: 'match', reason: MATCH_UNKNOWN });
  } else {
    skipped.push({ bucket: 'match', reason: NO_MATCH });
  }
  const avail = input.amountCents - matchCarve;
  const carveRows: SplitRow[] = matchCarve > 0 ? [{ bucket: 'match', amountCents: matchCarve }] : [];
  const phases: Phase[] = [];
  const pushPhase = (months: number | null, bucket: BucketId, amountCents: number): void => {
    if (amountCents > 0) phases.push({ months, rows: [...carveRows, { bucket, amountCents }] });
  };

  if (avail > 0) {
    // B1
    if (noBaseline || gaps.efFloorGapCents === 0) skipEf('ef_floor');
    else pushPhase(Math.ceil(gaps.efFloorGapCents / avail), 'ef_floor', avail);
    // B3 — payoff months from the amortization schedule, never naive division
    if (gaps.highLoans.length === 0) skipDebt('high_rate_debt');
    else pushPhase(debtPayoffMonths(gaps.highLoans, avail, todayIso), 'high_rate_debt', avail);
    // B4 — the floor phase already closed efFloorGapCents
    const b4Gap = Math.max(0, efTargetTotalCents - gaps.efFloorGapCents);
    if (noBaseline || efTargetTotalCents === 0) skipEf('ef_target');
    else if (b4Gap === 0) {
      // Review m2: covered by this split's floor phase — no skip row (the
      // floor phase on the same card already shows the EF being funded).
    } else pushPhase(Math.ceil(b4Gap / avail), 'ef_target', avail);
    // B5 per policy
    if (gaps.midLoans.length === 0) skipDebt('mid_rate_debt');
    else if (policy.midRate === 'fill') {
      pushPhase(debtPayoffMonths(gaps.midLoans, avail, todayIso), 'mid_rate_debt', avail);
    } else if (policy.midRate === 'minimums') {
      skipped.push({ bucket: 'mid_rate_debt', reason: aggressiveMinimums(low, high) });
    } else {
      // Moderate steady split until the band clears (odd cent to B5, D-GI11)
      const b5 = Math.floor(avail / 2) + (avail % 2);
      phases.push({
        months: debtPayoffMonths(gaps.midLoans, b5, todayIso),
        rows: [...carveRows, { bucket: 'mid_rate_debt', amountCents: b5 }, { bucket: 'invest', amountCents: avail - b5 }],
      });
    }
    // Ongoing terminal sink
    phases.push({ months: null, rows: [...carveRows, { bucket: 'invest', amountCents: avail }] });
  } else {
    // The whole flow is the match carve — a single ongoing match phase.
    phases.push({ months: null, rows: carveRows });
  }

  return {
    policyId, cadence: 'per-month', rows: phases[0]?.rows ?? [], phases, skipped,
    efMultiple: ef.multiple, efAssumed: ef.assumed && policy.id === 'moderate', gaps,
  };
}
