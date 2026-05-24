import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import DonutChartCard from './DonutChartCard';
import { colorForSector, shadedColorForIndustry } from './palette';
import { useConcentration } from '@/lib/use-concentration';
import { useTickersStore } from '@/stores/tickers-store';
import {
  aggregateByIndustry,
  aggregateBySector,
  buildSectorMap,
} from '@/lib/sector-classification';
import { formatCurrency } from '@/lib/format';

/**
 * Sector exposure donut that drills into industries on click.
 *
 * Default view: one wedge per resolved sector (Yahoo GICS classification
 * with pseudo-sector fallbacks from sector-classification.ts), colored
 * from SECTOR_COLORS. Clicking a wedge switches to that sector's
 * industry breakdown, colored as shaded variants of the parent sector
 * color so the connection reads at a glance. A "← Back to sectors"
 * link in the card subtitle returns to the default view.
 *
 * If the drilled-in sector becomes empty (e.g. the user sold every
 * holding in it), the view self-heals back to the sector overview
 * rather than leaving a stale "Industries — X" header above no data.
 */
export function SectorDonut() {
  const report = useConcentration();
  const tickers = useTickersStore((s) => s.tickers);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  const sectorMap = useMemo(() => buildSectorMap(tickers), [tickers]);

  const slices = useMemo(() => {
    if (selectedSector === null) {
      return aggregateBySector(report.perTicker, sectorMap).map((s) => ({
        ...s,
        color: colorForSector(s.name),
      }));
    }
    return aggregateByIndustry(report.perTicker, sectorMap, selectedSector).map((s, i) => ({
      ...s,
      color: shadedColorForIndustry(selectedSector, i),
    }));
  }, [report.perTicker, sectorMap, selectedSector]);

  useEffect(() => {
    if (selectedSector === null) return;
    if (slices.length === 0) setSelectedSector(null);
  }, [slices, selectedSector]);

  const onClickSlice = useCallback(
    (name: string) => {
      if (selectedSector === null) setSelectedSector(name);
    },
    [selectedSector],
  );

  const hasData = slices.some((s) => s.value > 0);
  if (!hasData) {
    return (
      <DonutChartCard
        title="Sector exposure"
        subtitle="After fund look-through"
        data={[]}
      />
    );
  }

  const title = selectedSector ? `Industries — ${selectedSector}` : 'Sector exposure';
  const subtitle = selectedSector ? (
    <button
      type="button"
      onClick={() => setSelectedSector(null)}
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
    >
      <ArrowLeft className="h-3 w-3" /> Back to sectors
    </button>
  ) : (
    'After fund look-through · click a sector to drill in'
  );

  return (
    <DonutChartCard
      title={title}
      subtitle={subtitle}
      data={slices}
      onClickSlice={selectedSector === null ? onClickSlice : undefined}
      valueFormatter={formatCurrency}
    />
  );
}

export default SectorDonut;
