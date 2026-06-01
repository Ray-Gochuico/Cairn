import { memo, useState } from 'react';
import {
  LineChart,
  Line,
  Area,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { BacktestResult, OutcomeTier } from '@/lib/backtest/types';
import { CHART_PALETTE } from '@/components/charts/palette';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
import { formatCompactCurrency } from '@/lib/format';

// ── Component contract ────────────────────────────────────────────────────────
export interface BacktestChartProps {
  result: BacktestResult;
  goalAmount: number;
  worstStartYear: number; // result.endings.worst.startYear — highlighted path
}

// ── Tier stroke constants (B1a/B1b) ──────────────────────────────────────────
// Solid stroke + strokeOpacity (NO alpha-channel CSS var).
// Colors are palette/semantic tokens — NOT raw hex.
const TIER_BLUE = CHART_PALETTE[0]; // #4c78a8 — same blue as bands + histogram

// BT-5: depleted/worst LINE uses --chart-danger (NOT --destructive).
// dark --destructive is a desaturated maroon fill token that drops to ~2:1 as a
// thin stroke; --chart-danger is ≥3:1 on both themes.
const TIER_DEPLETED = 'hsl(var(--chart-danger))';

// BT-5: below-tier LINE uses --chart-warning (NOT raw --warning).
// Raw --warning (amber-500) is only ~2.14:1 as a thin stroke on the light canvas.
// --chart-warning clears 3:1 as a thin stroke on both themes.
const TIER_BELOW = 'hsl(var(--chart-warning))';

const MEDIAN_STROKE = 'hsl(var(--foreground))';

// ── Line styling helper ───────────────────────────────────────────────────────
interface LineStyle {
  stroke: string;
  width: number;
  opacity: number;
  dash?: string;
}

function styleFor(
  startYear: number,
  tier: OutcomeTier,
  worstStartYear: number,
): LineStyle {
  if (startYear === worstStartYear)
    return { stroke: TIER_DEPLETED, width: 2, opacity: 1, dash: '5 3' };
  if (tier === 'depleted')
    return { stroke: TIER_DEPLETED, width: 1.25, opacity: 0.7, dash: '4 3' };
  if (tier === 'below') return { stroke: TIER_BELOW, width: 1.5, opacity: 0.85 };
  // met — recedes via strokeOpacity, NOT an alpha-channel CSS var
  return { stroke: TIER_BLUE, width: 1, opacity: 0.14 };
}

// ── Memoized per-line element (avoids re-creating on every render) ────────────
interface BacktestLineProps {
  startYear: number;
  tier: OutcomeTier;
  worstStartYear: number;
  isWorst: boolean;
}

const BacktestLine = memo(
  ({ startYear, tier, worstStartYear, isWorst }: BacktestLineProps) => {
    const s = styleFor(startYear, tier, worstStartYear);
    return (
      <Line
        key={startYear}
        type="monotone"
        dataKey={`y${startYear}`}
        stroke={s.stroke}
        strokeWidth={s.width}
        strokeOpacity={isWorst ? 1 : s.opacity}
        strokeDasharray={s.dash}
        dot={false}
        isAnimationActive={false}
      />
    );
  },
  (prev, next) =>
    prev.startYear === next.startYear &&
    prev.tier === next.tier &&
    prev.worstStartYear === next.worstStartYear &&
    prev.isWorst === next.isWorst,
);
BacktestLine.displayName = 'BacktestLine';

// ── Main component ────────────────────────────────────────────────────────────
export default function BacktestChart({
  result,
  goalAmount: _goalAmount,
  worstStartYear,
}: BacktestChartProps) {
  const [mode, setMode] = useState<'lines' | 'bands'>('lines');

  // ── Shared row dataset ────────────────────────────────────────────────────
  const years = result.outcomes[0]?.annualBalances.map((_, i) => i) ?? [];

  const lineRows: Record<string, number>[] = years.map((y) => {
    const row: Record<string, number> = {
      year: y,
      p50: result.percentilesByYear.p50[y] ?? 0,
    };
    for (const o of result.outcomes) {
      row[`y${o.startYear}`] = o.annualBalances[y] ?? 0;
    }
    return row;
  });

  const bandRows = years.map((y) => ({
    year: y,
    p10: result.percentilesByYear.p10[y] ?? 0,
    band1025:
      (result.percentilesByYear.p25[y] ?? 0) -
      (result.percentilesByYear.p10[y] ?? 0),
    band2575:
      (result.percentilesByYear.p75[y] ?? 0) -
      (result.percentilesByYear.p25[y] ?? 0),
    band7590:
      (result.percentilesByYear.p90[y] ?? 0) -
      (result.percentilesByYear.p75[y] ?? 0),
    p50: result.percentilesByYear.p50[y] ?? 0,
  }));

  // ── Shared axis / tooltip props ───────────────────────────────────────────
  const gridEl = (
    <CartesianGrid
      strokeDasharray="3 3"
      stroke="hsl(var(--border))"
    />
  );
  const xAxisEl = (
    <XAxis
      dataKey="year"
      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
      minTickGap={24}
    />
  );
  const yAxisEl = (
    <YAxis
      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
      tickFormatter={formatCompactCurrency}
      width={72}
    />
  );
  const tooltipEl = (
    <Tooltip
      {...CHART_TOOLTIP_PROPS}
      isAnimationActive={false}
      // BT-8 F4: dashed cursor for line chart (not solid bar cursor from the histogram preset)
      cursor={{ strokeDasharray: '3 3' }}
      formatter={(v) => formatCompactCurrency(Number(v))}
      labelFormatter={(y) => `Year ${y} of retirement`}
    />
  );

  // ── Mode toggle ───────────────────────────────────────────────────────────
  const modeToggle = (
    <div className="flex items-center gap-1" role="group" aria-label="Chart mode">
      <button
        type="button"
        aria-pressed={mode === 'lines'}
        onClick={() => setMode('lines')}
        data-testid="backtest-mode-lines"
        className={[
          'px-3 py-1 text-xs rounded-l border border-r-0',
          mode === 'lines'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-muted-foreground border-border hover:bg-muted',
        ].join(' ')}
      >
        Lines
      </button>
      <button
        type="button"
        aria-pressed={mode === 'bands'}
        onClick={() => setMode('bands')}
        data-testid="backtest-mode-bands"
        className={[
          'px-3 py-1 text-xs rounded-r border',
          mode === 'bands'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-muted-foreground border-border hover:bg-muted',
        ].join(' ')}
      >
        Bands
      </button>
    </div>
  );

  // ── Lines legend (names the SF-2 dash cue so tiers stay separable without color) ──
  const linesLegend = (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2"
      data-testid="backtest-legend-lines"
    >
      {/* Met goal — faint blue */}
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line x1="0" y1="4" x2="24" y2="4" stroke={TIER_BLUE} strokeWidth={1} strokeOpacity={0.4} />
        </svg>
        Met goal
      </span>
      {/* Below goal, survived — solid amber */}
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line x1="0" y1="4" x2="24" y2="4" stroke="hsl(var(--chart-warning))" strokeWidth={1.5} />
        </svg>
        Below goal, survived
      </span>
      {/* Depleted (dashed) — the SF-2 shape cue */}
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line
            x1="0" y1="4" x2="24" y2="4"
            stroke="hsl(var(--chart-danger))"
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
        </svg>
        Depleted (dashed)
      </span>
      {/* Median */}
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line x1="0" y1="4" x2="24" y2="4" stroke="hsl(var(--foreground))" strokeWidth={2.75} />
        </svg>
        Median
      </span>
    </div>
  );

  // ── Bands legend ──────────────────────────────────────────────────────────
  const bandsLegend = (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2"
      data-testid="backtest-legend-bands"
    >
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-6 h-3 rounded-sm"
          style={{ background: TIER_BLUE, opacity: 0.28 }}
        />
        25th–75th percentile
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-6 h-3 rounded-sm"
          style={{ background: TIER_BLUE, opacity: 0.12 }}
        />
        10th–25th / 75th–90th
      </span>
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line x1="0" y1="4" x2="24" y2="4" stroke={MEDIAN_STROKE} strokeWidth={2.75} />
        </svg>
        Median (p50)
      </span>
    </div>
  );

  // ── Caption text ──────────────────────────────────────────────────────────
  const caption =
    mode === 'lines' ? (
      <p
        className="text-xs text-muted-foreground mt-2 leading-relaxed"
        data-testid="backtest-caption"
      >
        Each faint line is one historical starting year — tinted by how it ended
        against your goal; dashed lines ran out before the horizon.
      </p>
    ) : (
      <p
        className="text-xs text-muted-foreground mt-2 leading-relaxed"
        data-testid="backtest-caption"
      >
        The shaded fan shows where outcomes clustered — reads more like a forecast
        cone, so switch to Lines to see which specific years failed.
      </p>
    );

  return (
    <div data-testid="backtest-chart" data-mode={mode} className="w-full">
      {/* Header row: Real $ indicator + mode toggle */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Real $</span>
        {modeToggle}
      </div>

      {/* Chart area */}
      {mode === 'lines' ? (
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={lineRows} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
            {gridEl}
            {xAxisEl}
            {yAxisEl}
            {tooltipEl}

            {/* Non-worst lines (drawn first, underneath) */}
            {result.outcomes
              .filter((o) => o.startYear !== worstStartYear)
              .map((o) => (
                <BacktestLine
                  key={o.startYear}
                  startYear={o.startYear}
                  tier={o.tier}
                  worstStartYear={worstStartYear}
                  isWorst={false}
                />
              ))}

            {/* Worst start year — full-strength, dashed, on top */}
            <Line
              type="monotone"
              dataKey={`y${worstStartYear}`}
              stroke={TIER_DEPLETED}
              strokeWidth={2}
              strokeOpacity={1}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />

            {/* Median — full-strength foreground, on top */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke={MEDIAN_STROKE}
              strokeWidth={2.75}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart
            data={bandRows}
            margin={{ top: 16, right: 16, bottom: 4, left: 4 }}
          >
            {gridEl}
            {xAxisEl}
            {yAxisEl}
            {tooltipEl}

            {/* Invisible floor — positions the stacked fan */}
            <Area
              type="monotone"
              dataKey="p10"
              fill="transparent"
              stroke="none"
              stackId="fan"
              isAnimationActive={false}
            />

            {/* p10–p25 outer band */}
            <Area
              type="monotone"
              dataKey="band1025"
              fill={TIER_BLUE}
              fillOpacity={0.12}
              stroke="none"
              stackId="fan"
              isAnimationActive={false}
            />

            {/* p25–p75 inner band (densest cluster) */}
            <Area
              type="monotone"
              dataKey="band2575"
              fill={TIER_BLUE}
              fillOpacity={0.28}
              stroke="none"
              stackId="fan"
              isAnimationActive={false}
            />

            {/* p75–p90 outer band */}
            <Area
              type="monotone"
              dataKey="band7590"
              fill={TIER_BLUE}
              fillOpacity={0.12}
              stroke="none"
              stackId="fan"
              isAnimationActive={false}
            />

            {/* Median line */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke={MEDIAN_STROKE}
              strokeWidth={2.75}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {mode === 'lines' ? linesLegend : bandsLegend}
      {caption}
    </div>
  );
}
