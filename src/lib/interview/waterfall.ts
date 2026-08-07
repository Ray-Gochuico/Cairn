import { frameworkById, type FrameworkId } from '@/domain/interview/frameworks';
import { computeBucketGaps, type BucketGaps } from './gaps';
import type { Cadence, InterviewContext } from '@/types/interview';

export type BucketId =
  | 'ef_floor' | 'match' | 'high_rate_debt' | 'ef_target' | 'mid_rate_debt' | 'invest';

export interface SplitRow { bucket: BucketId; amountCents: number }
export interface SkipEntry { bucket: BucketId; reason: string }
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
    if (noBaseline || b4Gap === 0) skipEf('ef_target');
    else take('ef_target', b4Gap);
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

  throw new Error('per-month lands in Task 5');
}
