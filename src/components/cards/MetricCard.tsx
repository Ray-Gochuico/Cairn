import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Reusable metric card — a single big number surfaced inside a shadcn Card.
 *
 * Composition: label (small uppercase muted) + value (big number) + optional
 * delta (colored by tone) + optional subtitle. When `href` is provided the
 * whole card is wrapped in a router Link with hover affordance, so the card
 * itself behaves like a button. Consumers stay declarative — they pass
 * preformatted strings and pick the tone; this component owns layout only.
 *
 * Kept Dashboard-agnostic on purpose so future pages can reuse it.
 */

export type MetricCardTone = 'positive' | 'negative' | 'neutral';

export interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: MetricCardTone;
  href?: string;
  subtitle?: string;
}

function deltaClass(tone: MetricCardTone | undefined): string {
  switch (tone) {
    case 'positive': return 'text-success';
    case 'negative': return 'text-destructive';
    case 'neutral':
    case undefined:
    default: return 'text-muted-foreground';
  }
}

function MetricCardImpl({
  label,
  value,
  delta,
  deltaTone,
  href,
  subtitle,
}: MetricCardProps) {
  const card = (
    <Card
      className={cn(
        'h-full min-w-0',
        href && 'transition-colors hover:bg-accent/40 cursor-pointer',
      )}
      data-testid="metric-card"
    >
      <CardHeader className="pb-2">
        {/*
         * Label readability across viewport widths is the headline contract
         * here. A prior iteration used Tailwind's `truncate` (overflow-hidden +
         * text-ellipsis + nowrap) which produced mid-word ellipses at <1280px
         * — "AWAITING REIMBU…" / "SPENDING VS BU…" — for our default
         * Dashboard pills. We now line-clamp to 2 lines instead: the label
         * wraps on whitespace (no mid-word splits) and falls back to a single
         * trailing ellipsis only when even two lines aren't enough. The native
         * `title` and `aria-label` (applied on the wrapping link below) ensure
         * the full text is still reachable for keyboard/screen-reader users
         * and as a hover tooltip for mouse users.
         */}
        <div
          className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground line-clamp-2 break-words [overflow-wrap:anywhere] min-h-[1.5em]"
          title={label}
          data-testid="metric-card-label"
        >
          {label}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <div
            className="text-xl sm:text-2xl md:text-3xl font-semibold leading-tight tabular-nums whitespace-nowrap overflow-hidden text-ellipsis min-w-0 max-w-full"
            title={value}
            data-testid="metric-card-value"
          >
            {value}
          </div>
          {delta ? (
            <div
              className={cn(
                'text-xs sm:text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full',
                deltaClass(deltaTone),
              )}
              title={delta}
            >
              {delta}
            </div>
          ) : null}
        </div>
        {subtitle ? (
          <div className="text-xs text-muted-foreground truncate" title={subtitle}>
            {subtitle}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  if (href) {
    // The composed accessible name on the wrapping link gives screen-reader
    // and keyboard-focus users the full label even when the visible label
    // line-clamps. Delta/subtitle are intentionally excluded to keep the
    // announcement short; they're available via the visible text on hover.
    const ariaLabel = `${label}: ${value}`;
    return (
      <Link
        to={href}
        aria-label={ariaLabel}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      >
        {card}
      </Link>
    );
  }
  return card;
}

// Wave-5 frontend A+ #3: memo wraps a pure render that only depends on
// preformatted-string props. Dashboard renders 5+ pills per render; if the
// parent re-renders for another reason (any pill stat changing, filter
// toggle, etc.) the unchanged pills should skip reconciliation. Props are
// primitives + a single optional string, so React.memo's default shallow
// compare is sufficient.
const MetricCard = memo(MetricCardImpl);
MetricCard.displayName = 'MetricCard';

export default MetricCard;
