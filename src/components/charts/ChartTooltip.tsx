import type { CSSProperties } from 'react';

/**
 * Shared Recharts tooltip theming.
 *
 * Recharts ships its default `<Tooltip />` with hardcoded
 * `background: #fff` baked into the inline style — which reads as a
 * stark white card on a dark background. This module exposes the
 * `contentStyle` (and matching `cursor` / `wrapperStyle` / `itemStyle` /
 * `labelStyle`) presets that point at the design-system CSS variables
 * (`--popover`, `--popover-foreground`, `--border`, `--muted-foreground`)
 * so every Recharts tooltip on the app inherits the same look in light
 * AND dark mode.
 *
 * Drop-in usage on any Recharts chart:
 *
 *     import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
 *     ...
 *     <Tooltip {...CHART_TOOLTIP_PROPS} />
 *
 * Combine with a custom `formatter` or `labelFormatter` as needed:
 *
 *     <Tooltip {...CHART_TOOLTIP_PROPS} formatter={fmt} />
 *
 * Charts that ship a fully custom tooltip surface (e.g. the per-asset
 * decomposition tooltips in `AssetValueChart` / `ProjectionChart`)
 * override the *body* of the tooltip via
 * Recharts' `content` prop — those don't need this preset because the
 * white background lives inside Recharts' default body, not the cursor
 * line or wrapper. The two are intentionally orthogonal.
 */

export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  color: 'hsl(var(--popover-foreground))',
  borderRadius: 6,
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
};

export const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'hsl(var(--popover-foreground))',
  fontWeight: 500,
  marginBottom: 4,
};

export const CHART_TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'hsl(var(--popover-foreground))',
};

export const CHART_TOOLTIP_CURSOR = {
  // Recharts paints this rectangle / vertical line behind the hover —
  // muted token keeps it visible in both light and dark modes (default
  // is a hardcoded `#ccc` which disappears on dark).
  fill: 'hsl(var(--muted) / 0.5)',
  stroke: 'hsl(var(--muted-foreground))',
  strokeOpacity: 0.4,
};

/**
 * Spread this onto a Recharts `<Tooltip />` to inherit the dark-mode-
 * aware theme. The four constants above are exported separately for
 * call-sites that need to extend / override a single slot.
 */
export const CHART_TOOLTIP_PROPS = {
  contentStyle: CHART_TOOLTIP_CONTENT_STYLE,
  labelStyle: CHART_TOOLTIP_LABEL_STYLE,
  itemStyle: CHART_TOOLTIP_ITEM_STYLE,
  cursor: CHART_TOOLTIP_CURSOR,
} as const;
