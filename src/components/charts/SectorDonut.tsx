import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from './DonutEntityPicker';
import { colorForSector, shadedColorForIndustry } from './palette';
import { useConcentration } from '@/lib/use-concentration';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import {
  aggregateByIndustry,
  aggregateBySector,
  buildSectorMap,
  type FundSectorWeights,
} from '@/lib/sector-classification';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Module-level empty-data sentinel for the empty-state donut. Hoisted so the
// `data` prop keeps a stable reference across renders — recharts' Pie keys
// its <JavascriptAnimate> off `useAnimationId(props)`, which uses reference
// equality on the entire props object, and a fresh `[]` each render churns
// the animation lifecycle.
const EMPTY_DONUT_DATA: DonutSlice[] = [];
const STORAGE_KEY = 'donut.sector.hidden';

/**
 * Sector exposure donut that drills into industries on click.
 *
 * Default view: one wedge per resolved sector (Yahoo's Morningstar-style
 * labels — "Financial Services", "Healthcare", "Consumer Cyclical" — with
 * pseudo-sector fallbacks from sector-classification.ts), colored from
 * SECTOR_COLORS. Clicking a wedge switches to that sector's industry
 * breakdown, colored as shaded variants of the parent sector color so the
 * connection reads at a glance. A "← Back to sectors" link in the card
 * subtitle returns to the default view.
 *
 * If the drilled-in sector becomes empty (e.g. the user sold every
 * holding in it), the view self-heals back to the sector overview
 * rather than leaving a stale "Industries — X" header above no data.
 *
 * Picker: a header popover lets the user hide individual sectors; the
 * hidden set persists in localStorage under `donut.sector.hidden`. Keys
 * are sector name strings. The picker is hidden in the industry
 * drill-in view because it operates on SECTORS only — industries are
 * dependent slices of the chosen sector, not independently toggleable.
 */
export function SectorDonut() {
  const report = useConcentration();
  const tickers = useTickersStore((s) => s.tickers);
  const fundSectors = useFundSectorsStore((s) => s.fundSectors);
  const loadFundSectors = useFundSectorsStore((s) => s.load);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  // Load fund sectors on mount so the donut has data on first paint. The
  // Investments page also loads the holdings/tickers/fund-holdings stores
  // in its own mount block; this is the same pattern for sectors.
  useEffect(() => {
    loadFundSectors();
  }, [loadFundSectors]);

  const sectorMap = useMemo(() => buildSectorMap(tickers), [tickers]);

  const fundSectorWeights = useMemo(() => {
    const map = new Map<string, { sector: string; weight: number }[]>();
    for (const fs of fundSectors) {
      const rows = map.get(fs.fundTicker) ?? [];
      rows.push({ sector: fs.sector, weight: fs.weight });
      map.set(fs.fundTicker, rows);
    }
    return map as ReadonlyMap<string, FundSectorWeights>;
  }, [fundSectors]);

  // Sector-view slices are independent of the picker filter so the picker
  // items can enumerate ALL sectors (not just the ones currently shown).
  const sectorSlices = useMemo(() => {
    // Sector view consumes the PRE-look-through `tickerExposures` so fund
    // tickers (VTI, FXAIX, ...) stay intact and can be distributed across
    // their fund_sectors weights. `report.perTicker` is post-look-through
    // (AAPL/MSFT/Misc) and would collapse the donut into 'Unclassified' +
    // 'Misc' — that was the regression two earlier fixes missed.
    const agg = aggregateBySector(report.tickerExposures, sectorMap, fundSectorWeights);
    return agg.map((s) => ({
      ...s,
      color: colorForSector(s.name),
    }));
  }, [report.tickerExposures, sectorMap, fundSectorWeights]);

  const pickerItems = useMemo<DonutEntityPickerItem[]>(
    () =>
      sectorSlices.map((s) => ({
        key: s.name,
        label: s.name,
        color: s.color,
      })),
    [sectorSlices],
  );
  const allKeys = useMemo(() => pickerItems.map((i) => i.key), [pickerItems]);
  const selected = useDonutSelected(STORAGE_KEY, allKeys);

  const slices = useMemo(() => {
    if (selectedSector === null) {
      return sectorSlices.filter((s) => selected.has(s.name));
    }
    // Industry drill-down stays on perTicker: it operates on individual
    // companies (AAPL/MSFT/JPM) where the post-look-through view is correct.
    return aggregateByIndustry(report.perTicker, sectorMap, selectedSector).map((s, i) => ({
      ...s,
      color: shadedColorForIndustry(selectedSector, i),
    }));
  }, [report.perTicker, sectorMap, selectedSector, sectorSlices, selected]);

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

  const hasData = sectorSlices.some((s) => s.value > 0);
  if (!hasData) {
    return (
      <DonutChartCard
        title="Sector exposure"
        subtitle="After fund look-through"
        data={EMPTY_DONUT_DATA}
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

  // Picker is rendered only in sector view. In industry drill-in mode,
  // hiding it avoids the confusion of "what would toggling do here?" —
  // industries are dependent slices, not independently toggleable.
  const picker = selectedSector === null ? (
    <DonutEntityPicker localStorageKey={STORAGE_KEY} items={pickerItems} />
  ) : null;

  // All sectors hidden — surface the explainer instead of an empty pie.
  if (selectedSector === null && slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Sector exposure</CardTitle>
            {picker}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            All entities hidden. Open the picker above to show at least one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative">
      {picker && <div className="absolute top-4 right-4 z-10">{picker}</div>}
      <DonutChartCard
        title={title}
        subtitle={subtitle}
        data={slices}
        onClickSlice={selectedSector === null ? onClickSlice : undefined}
        valueFormatter={formatCurrency}
      />
    </div>
  );
}

export default SectorDonut;
