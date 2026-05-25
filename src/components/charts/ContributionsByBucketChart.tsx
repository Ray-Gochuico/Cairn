import { useMemo } from 'react';
import BarChartCard from './BarChartCard';
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
 * (Brokerage, 401k, 401k Match, Roth IRA, Trad IRA, HSA, 529). Sits on the
 * Investments page below the existing single-series "Contributions (last
 * 12 months)" chart so the user can see how flows are split across
 * tax-treatment buckets without losing the simple total view above.
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
      title="Contributions by destination"
      subtitle="Stacked monthly totals by account type"
      data={data}
      xKey="month"
      series={series}
      yFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
    />
  );
}
