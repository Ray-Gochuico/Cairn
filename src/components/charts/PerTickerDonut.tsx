import DonutChartCard from './DonutChartCard';
import { topNWithMisc } from '@/lib/concentration';
import { useConcentration } from '@/lib/use-concentration';
import { formatCurrency } from '@/lib/format';

/**
 * Per-company effective exposure donut with top-10 + Misc rollup.
 * Sits alongside the asset-class allocation donut on Investments —
 * the asset-class view shows "what categories you're in"; this view
 * shows "what individual companies you're exposed to" after fund
 * look-through. SHORT-direction holdings produce negative
 * effectiveExposure; we clamp to non-negative so the donut renders
 * meaningfully (SHORT-aware viz is Phase 5+).
 */
export function PerTickerDonut() {
  const report = useConcentration();
  const slices = topNWithMisc(report.perTicker, 10).map((s) => ({
    name: s.ticker,
    // Donut can't render negative wedges; SHORT exposures get clamped here.
    value: Math.max(0, s.effectiveExposure),
  }));
  const hasData = slices.some((s) => s.value > 0);
  if (!hasData) {
    return (
      <DonutChartCard
        title="Per-company exposure"
        subtitle="After fund look-through"
        data={[]}
      />
    );
  }
  return (
    <DonutChartCard
      title="Per-company exposure"
      subtitle="Top 10 + Misc, after fund look-through"
      data={slices}
      valueFormatter={formatCurrency}
    />
  );
}

export default PerTickerDonut;
