import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { HorizonGrowth } from '@/lib/growth-horizons';

export interface GrowthCardProps {
  title: string;
  /**
   * One entry per time horizon, in display order (1d → 1y). Built by
   * computeHorizonGrowth() on the page — this component is purely
   * presentational and does no data fetching of its own.
   */
  horizons: HorizonGrowth[];
  /** Defaults to the app-wide whole-dollar currency formatter. */
  valueFormatter?: (n: number) => string;
}

/** "+10.0%" / "-3.4%" from a fraction (0.1 -> "+10.0%"). */
function formatPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// Short chip label per horizon key; the full label rides on aria-label.
const CHIP_LABELS: Record<string, string> = {
  '1d': '1D', '1w': '1W', '1m': '1M', '1q': '1Q', '1y': '1Y',
};

/**
 * Growth card with a visible horizon-chip row. Shows portfolio growth for
 * the selected horizon; the chips replace the old whole-card
 * click-to-cycle (which was undiscoverable, a surprising giant click
 * target, and noisy for SRs). Lives beside the donut cards on
 * Investments / Net Worth, so it reuses the same shadcn Card primitives
 * and muted/foreground tokens to stay visually consistent.
 */
export default function GrowthCard({
  title,
  horizons,
  valueFormatter = formatCurrency,
}: GrowthCardProps) {
  const [activeKey, setActiveKey] = useState(horizons[0]?.key ?? '1d');

  // Defensive: with no horizons there's nothing to show. Render a minimal
  // card rather than crash on the find below. (Pages always pass the five,
  // so this is belt-and-suspenders.)
  if (horizons.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data.</p>
        </CardContent>
      </Card>
    );
  }

  const active = horizons.find((h) => h.key === activeKey) ?? horizons[0];

  const isUp = active.available && (active.deltaAbs ?? 0) >= 0;
  const deltaColor = isUp ? 'text-success' : 'text-destructive';
  const DeltaArrow = isUp ? ArrowUp : ArrowDown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        {/* One range grammar (Wave 3): the same segmented tabs as the
            asset-value chart's window control. Radix gives the chip row
            arrow-key roving focus + tab semantics for free — the old
            whole-card role="button" cycle was invisible to discovery and
            noisy for SRs. */}
        <Tabs value={active.key} onValueChange={setActiveKey}>
          <TabsList className="h-7" aria-label="Time horizon">
            {horizons.map((h) => (
              <TabsTrigger key={h.key} value={h.key} aria-label={h.label} className="px-2 py-0.5 text-xs">
                {CHIP_LABELS[h.key] ?? h.key.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            {active.label}
          </div>
          <div className="text-xs text-muted-foreground">
            vs {active.baselineDate}
          </div>
        </div>

        {active.available ? (
          <div className="space-y-1">
            <div className="text-3xl font-semibold tabular-nums">
              {active.current != null ? valueFormatter(active.current) : '—'}
            </div>
            <div
              className={cn(
                'flex items-center gap-1 text-sm font-medium tabular-nums',
                deltaColor,
              )}
            >
              <DeltaArrow className="h-4 w-4" aria-hidden />
              <span>
                {/* deltaAbs is signed via the formatter's value, but we force
                    a leading + for non-negative so the direction reads clearly
                    alongside the arrow. */}
                {(active.deltaAbs ?? 0) >= 0 ? '+' : ''}
                {active.deltaAbs != null ? valueFormatter(active.deltaAbs) : '—'}
              </span>
              {active.deltaPct != null && (
                <span>({formatPct(active.deltaPct)})</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {active.current != null && (
              <div className="text-3xl font-semibold tabular-nums">
                {valueFormatter(active.current)}
              </div>
            )}
            <div className="text-sm text-muted-foreground">
              Not enough history yet
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
