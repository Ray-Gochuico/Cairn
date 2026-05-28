import { useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

/**
 * Cycling growth card. Shows portfolio growth for one horizon at a time and
 * advances (wrapping) on click / Enter / Space / arrow keys. The whole card
 * is a button so the affordance is obvious and keyboard-accessible; the
 * chevrons are decorative hints that share the card's click (they stop
 * propagation only to drive direction, not to swallow the activation).
 *
 * Lives beside the donut cards on Investments / Net Worth, so it reuses the
 * same shadcn Card primitives and muted/foreground tokens to stay visually
 * consistent.
 */
export default function GrowthCard({
  title,
  horizons,
  valueFormatter = formatCurrency,
}: GrowthCardProps) {
  const [index, setIndex] = useState(0);

  // Defensive: with no horizons there's nothing to cycle. Render a minimal
  // card rather than crash on horizons[index] below. (Pages always pass the
  // five, so this is belt-and-suspenders.)
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

  const count = horizons.length;
  const advance = (step: number) =>
    setIndex((i) => (i + step + count) % count);
  const active = horizons[index];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      advance(-1);
    }
  };

  const isUp = active.available && (active.deltaAbs ?? 0) >= 0;
  const deltaColor = isUp ? 'text-success' : 'text-destructive';
  const DeltaArrow = isUp ? ArrowUp : ArrowDown;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${title}: ${active.label}. Click to view the next time horizon.`}
      onClick={() => advance(1)}
      onKeyDown={onKeyDown}
      className="cursor-pointer select-none transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-1 text-muted-foreground">
          <button
            type="button"
            aria-label="Previous time horizon"
            className="rounded p-0.5 hover:text-foreground"
            onClick={(e) => {
              // Stop the card's onClick (which advances) so the left chevron
              // can step backward instead.
              e.stopPropagation();
              advance(-1);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next time horizon"
            className="rounded p-0.5 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              advance(1);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
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

        {/* Position indicator — five dots, the active one filled. Mirrors the
            horizon order so the user can see where they are in the cycle. */}
        <div className="flex items-center gap-1.5 pt-1" aria-hidden>
          {horizons.map((h, i) => (
            <span
              key={h.key}
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                i === index ? 'bg-foreground' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
