import type { BacktestResult, OutcomeTier, StartYearOutcome } from './types';

export function classifyTier(endingBalance: number, goalAmount: number): OutcomeTier {
  if (endingBalance <= 0) return 'depleted';
  if (endingBalance >= goalAmount) return 'met';
  return 'below';
}

/** Linear-interpolated percentile of a numeric array (p in 0..100). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function percentileSeries(outcomes: StartYearOutcome[], p: number): number[] {
  const len = outcomes[0]?.annualBalances.length ?? 0;
  const out: number[] = [];
  for (let y = 0; y < len; y++) {
    const col = outcomes
      .map((o) => o.annualBalances[y] ?? 0)
      .sort((a, b) => a - b);
    out.push(Math.round(percentile(col, p)));
  }
  return out;
}

// `_goalAmount` is intentionally unused: each StartYearOutcome arrives already
// classified (engine set `tier` via classifyTier(ending, goalAmount)), so the
// aggregator summarizes pre-tagged tiers and never re-derives from the goal.
// The param is kept for call-site symmetry with the engine (aggregate(outcomes,
// config.goalAmount)) and documents that the goal is the classifier's input.
export function aggregate(outcomes: StartYearOutcome[], _goalAmount: number): BacktestResult {
  const tierCounts = { met: 0, below: 0, depleted: 0 };
  for (const o of outcomes) tierCounts[o.tier] += 1;

  const belowGoal = outcomes
    .filter((o) => o.tier !== 'met')
    .map((o) => ({
      startYear: o.startYear,
      endingBalance: o.endingBalance,
      tier: o.tier as Exclude<OutcomeTier, 'met'>,
    }))
    .sort((a, b) => a.startYear - b.startYear);

  const sortedByEnding = [...outcomes].sort((a, b) => a.endingBalance - b.endingBalance);
  const worst = sortedByEnding[0];
  const best = sortedByEnding[sortedByEnding.length - 1];
  const endingsSorted = sortedByEnding.map((o) => o.endingBalance);
  const median = percentile(endingsSorted, 50);

  const years = outcomes.map((o) => o.startYear);

  return {
    outcomes,
    startYears: {
      first: Math.min(...years),
      last: Math.max(...years),
      count: outcomes.length,
    },
    goalMetCount: tierCounts.met,
    survivedCount: tierCounts.met + tierCounts.below,
    tierCounts,
    belowGoal,
    endings: {
      worst: { value: worst.endingBalance, startYear: worst.startYear, depletedYear: worst.depletedYear },
      median,
      best: { value: best.endingBalance, startYear: best.startYear },
    },
    percentilesByYear: {
      p10: percentileSeries(outcomes, 10),
      p25: percentileSeries(outcomes, 25),
      p50: percentileSeries(outcomes, 50),
      p75: percentileSeries(outcomes, 75),
      p90: percentileSeries(outcomes, 90),
    },
  };
}
