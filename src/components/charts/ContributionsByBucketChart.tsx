import { useMemo } from 'react';
import BarChartCard from './BarChartCard';

/**
 * Format a dollar amount for the y-axis, adapting to value magnitude:
 *   < $1,000  → "$500"   (sub-K values: show raw dollars, no decimals)
 *   ≥ $1,000  → "$1.5k"  (K-denominated with one decimal)
 * This avoids the "$0.0k" / "$0.5k" illegibility that occurs when monthly
 * contributions are small (e.g. $100-$900).
 */
function formatContributionY(v: number): string {
  if (v < 1000) return `$${Math.round(v)}`;
  return `$${(v / 1000).toFixed(1)}k`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Abbreviate a YYYY-MM x-axis tick to a short 3-letter month name.
 * Keeps labels short enough so all 12 ticks fit without overlapping when
 * xAxisInterval={0}.
 */
function formatContributionXTick(value: unknown): string {
  const s = String(value ?? '');
  // Expected format: "YYYY-MM"
  const monthIdx = parseInt(s.slice(5, 7), 10) - 1;
  return MONTH_NAMES[monthIdx] ?? s;
}
import {
  aggregateContributionsByBucket,
  CONTRIBUTION_BUCKETS,
  type ContributionBucket,
} from '@/lib/contributions-by-bucket';
import { CHART_PALETTE } from './palette';
import type { Account, Contribution } from '@/types/schema';

const STACK_ID = 'contributions';

/**
 * Distinct color per bucket. Kept stable across re-renders so the legend
 * doesn't shuffle when the user flips the household / person filter.
 */
const BUCKET_COLORS: Record<ContributionBucket, string> = {
  Brokerage:    CHART_PALETTE[0],
  '401k':       CHART_PALETTE[1],
  '401k Match': CHART_PALETTE[2],
  'Roth 401k':  CHART_PALETTE[7],
  'Roth IRA':   CHART_PALETTE[3],
  'Trad IRA':   CHART_PALETTE[4],
  HSA:          CHART_PALETTE[5],
  '529':        CHART_PALETTE[6],
};

export interface ContributionsByBucketChartProps {
  accounts: ReadonlyArray<Account>;
  contributions: ReadonlyArray<Contribution>;
  /** Inclusive YYYY-MM range — typically the last N months. */
  fromYyyymm: string;
  toYyyymm: string;
}

/**
 * Stacked monthly contributions broken out by destination bucket
 * (Brokerage, 401k, 401k Match, Roth IRA, Trad IRA, HSA, 529). This is the
 * only contributions chart on the Investments page — the monthly total reads
 * directly as the stack height, and per-bucket flows are visible both in the
 * stack segments and in the tooltip on hover. The subtitle explicitly calls
 * out "Stack height = total" so users don't look for a separate totals chart.
 */
export default function ContributionsByBucketChart({
  accounts,
  contributions,
  fromYyyymm,
  toYyyymm,
}: ContributionsByBucketChartProps) {
  const data = useMemo(
    () => aggregateContributionsByBucket(contributions, accounts, fromYyyymm, toYyyymm),
    [contributions, accounts, fromYyyymm, toYyyymm],
  );
  const series = useMemo(
    () =>
      CONTRIBUTION_BUCKETS.map((bucket) => ({
        dataKey: bucket,
        label: bucket,
        color: BUCKET_COLORS[bucket],
        stackId: STACK_ID,
      })),
    [],
  );
  return (
    <BarChartCard
      title="Monthly contributions by bucket"
      subtitle="Stack height = total; stacked by account type (last 12 months)"
      data={data}
      xKey="month"
      series={series}
      yFormatter={formatContributionY}
      xAxisInterval={0}
      xTickFormatter={formatContributionXTick}
      emptyMessage="No contributions recorded in this window yet — log them in Inputs → Contributions."
    />
  );
}
