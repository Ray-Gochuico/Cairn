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
    case 'positive': return 'text-emerald-600';
    case 'negative': return 'text-red-600';
    case 'neutral':
    case undefined:
    default: return 'text-muted-foreground';
  }
}

export default function MetricCard({
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
        <div
          className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground truncate"
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
    return (
      <Link to={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        {card}
      </Link>
    );
  }
  return card;
}
