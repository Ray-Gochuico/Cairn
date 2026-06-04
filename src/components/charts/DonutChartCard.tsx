import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { paletteColorAt } from './palette';
import { CHART_TOOLTIP_PROPS } from './ChartTooltip';

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

// Long legends (Per-Company has ~11 items) wrap to 3+ rows and crowd the
// card. Past THRESHOLD, collapse to the first COLLAPSED_COUNT entries behind
// a "Show all (N)/Show less" toggle. Legend-only — the Pie always gets every
// slice (collapsing the chart would silently drop wedges).
const LEGEND_COLLAPSE_THRESHOLD = 6;
const LEGEND_COLLAPSED_COUNT = 5;

export interface DonutChartCardProps {
  title: string;
  /**
   * Subtitle text or any ReactNode (e.g. a "Back" button for drill-down
   * donuts). Renders inside CardDescription.
   */
  subtitle?: ReactNode;
  height?: number;
  data: DonutSlice[];
  innerRadius?: number;
  outerRadius?: number;
  labelFormatter?: (slice: DonutSlice) => string;
  /**
   * Formats raw slice values for the tooltip. Use for $ or % displays.
   * If omitted, Recharts shows the raw number.
   */
  valueFormatter?: (value: number) => string;
  /**
   * Optional. Formats the slice name shown in the tooltip. The legend
   * keeps showing the raw slice name unchanged. Use this to show longer
   * labels (e.g., "AAPL — Apple Inc.") on hover without bloating the legend.
   */
  tooltipNameFormatter?: (name: string) => string;
  /**
   * Optional. Formats the slice name shown in the legend only — the
   * underlying slice `name` (used as the React key, color identity, and
   * tooltip match key) stays untouched. Used by PerTickerDonut to render
   * "Company Name (TICKER)" in the legend without changing slice identity.
   * Omitted elsewhere, so the other donuts keep showing the raw name.
   */
  legendLabelFormatter?: (name: string) => string;
  /**
   * Optional. Invoked with the clicked slice's `name` when a wedge is
   * clicked. Setting this also flips the donut to a pointer cursor so
   * the affordance is visible. Used by SectorDonut to drill into a
   * sector's industry breakdown.
   */
  onClickSlice?: (sliceName: string) => void;
}

export default function DonutChartCard({
  title,
  subtitle,
  height = 240,
  data,
  innerRadius = 60,
  outerRadius = 90,
  labelFormatter,
  valueFormatter,
  tooltipNameFormatter,
  legendLabelFormatter,
  onClickSlice,
}: DonutChartCardProps) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const collapsible = data.length > LEGEND_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  // Drop a stale expanded state when the data shrinks back at/under the
  // threshold — otherwise re-growing past it would render pre-expanded.
  useEffect(() => {
    if (!collapsible && expanded) setExpanded(false);
  }, [collapsible, expanded]);
  // Render the legend as plain DOM below the chart rather than via recharts'
  // <Legend/>. Recharts stuffs its legend inside the same fixed-height
  // ResponsiveContainer as the donut and gives it whatever vertical space
  // is left — when a many-wedge donut (Per-Company has ~11 items) forces
  // the legend to wrap to 2-3 rows, those rows overlap the donut SVG
  // because the container height is fixed and the donut's pie geometry
  // doesn't shrink to make room. Pulling the legend out into a sibling
  // <ul> lets it flow naturally underneath without eating into the chart.
  // Slices that carry their own resolved color (the entity-keyed donuts) win;
  // any colorless caller falls back to the principled WEDGE_PALETTE so a wedge
  // can never dissolve into the card (I9). Both the Cell fill and the legend
  // swatch below call this, so one source keeps wedge == legend.
  const colorAt = (slice: DonutSlice, idx: number) =>
    slice.color ?? paletteColorAt(idx);
  // Legend-only collapse: cap the rendered rows when collapsed; the Pie below
  // still receives the full `data`.
  const visibleLegend =
    collapsible && !expanded ? data.slice(0, LEGEND_COLLAPSED_COUNT) : data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={1}
                // Thin wedges otherwise render at ~0° and the --card stroke
                // swallows them whole (the legend swatch still shows color —
                // the tell). A stable literal floor angle keeps tiny slices
                // visible; literal (not data-derived) so it's animation-safe.
                minAngle={2}
                // Recharts 3.x Pie passes its entire (always-fresh) props object
                // into useAnimationId, so animationId churns every render and the
                // key={animationId} on <JavascriptAnimate> remounts it on every
                // render — its cleanup calls onAnimationEnd → setIsAnimating, which
                // re-renders Pie and loops. Mirrors ProjectionChart's stance.
                isAnimationActive={false}
                label={
                  labelFormatter
                    ? (entry) => labelFormatter(entry as DonutSlice)
                    : undefined
                }
                onClick={
                  onClickSlice
                    ? (entry: unknown) => {
                        const name = (entry as { name?: unknown } | undefined)?.name;
                        if (typeof name === 'string') onClickSlice(name);
                      }
                    : undefined
                }
                style={onClickSlice ? { cursor: 'pointer' } : undefined}
              >
                {data.map((slice, idx) => (
                  <Cell
                    key={`${slice.name}-${idx}`}
                    fill={colorAt(slice, idx)}
                    // App-wide (W4): follow the card background so wedge borders
                    // don't show Recharts' default white hairline on dark cards
                    // and adjacent wedges stay visually separated in both themes.
                    stroke="hsl(var(--card))"
                    // Keep the --card stroke a 1px hairline — wide strokes are
                    // what made minAngle wedges read as colorless seams.
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip
                {...CHART_TOOLTIP_PROPS}
                formatter={(value, name) => {
                  const displayName = tooltipNameFormatter && typeof name === 'string'
                    ? tooltipNameFormatter(name)
                    : String(name ?? '');
                  if (typeof value !== 'number') {
                    return [String(value ?? ''), displayName];
                  }
                  const pct = total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : '';
                  const formatted = valueFormatter ? `${valueFormatter(value)}${pct}` : `${value}${pct}`;
                  return [formatted, displayName];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {data.length > 0 && (
            <ul
              className="mt-3 flex max-h-40 flex-wrap justify-center gap-x-3 gap-y-1 overflow-y-auto text-xs text-muted-foreground"
              aria-label="Chart legend"
            >
              {visibleLegend.map((slice, idx) => (
                <li
                  key={`${slice.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: colorAt(slice, idx) }}
                  />
                  {legendLabelFormatter ? legendLabelFormatter(slice.name) : slice.name}
                </li>
              ))}
            </ul>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Show less' : `Show all (${data.length})`}
              {expanded ? (
                <ChevronUp aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown aria-hidden className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
