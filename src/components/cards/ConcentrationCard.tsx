import { memo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useConcentration } from '@/lib/use-concentration';
import { topEffectiveExposures } from '@/lib/concentration';
import { FreshnessBadge } from '@/components/ui/freshness-badge';

/**
 * Dashboard-sized concentration summary. Shows the warning count as the
 * headline number plus up to three top warnings, each with a severity-tinted
 * icon. Severity HIGH renders red, MEDIUM amber, LOW blue — matching the
 * Investments page's full breakdown for consistency. Tapping the card or
 * "See full breakdown" link navigates to Investments → Concentration Health.
 */
function severityColor(severity: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  switch (severity) {
    case 'HIGH': return 'text-destructive-soft-foreground';
    case 'MEDIUM': return 'text-warning-foreground';
    case 'LOW':
    default: return 'text-info-foreground';
  }
}

// Visible severity label + chip tint. The chip — not the icon tint alone —
// is now the accessible severity signal (tint-only fails color-blind and
// low-contrast readers), so the AlertTriangle beside it goes aria-hidden.
const SEVERITY_CHIP_BASE =
  'inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium';
function severityChip(severity: 'HIGH' | 'MEDIUM' | 'LOW'): { label: string; className: string } {
  switch (severity) {
    case 'HIGH': return { label: 'High', className: 'bg-destructive-soft text-destructive-soft-foreground' };
    case 'MEDIUM': return { label: 'Watch', className: 'bg-warning-soft text-warning-foreground' };
    case 'LOW':
    default: return { label: 'Note', className: 'bg-info-soft text-info-foreground' };
  }
}

function ConcentrationCardImpl() {
  const report = useConcentration();
  const count = report.warnings.length;
  // Healthy-state summary: the biggest effective position keeps the card
  // informative when there is nothing to warn about (no more dead end).
  const largest = topEffectiveExposures(report.perTicker, 1)[0] ?? null;

  return (
    <Card className="min-w-0 h-full" data-testid="concentration-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground truncate">
            Concentration
          </div>
          <FreshnessBadge size="sm" />
        </div>
        <div className="text-xl sm:text-2xl md:text-3xl font-semibold leading-tight tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          {count} {count === 1 ? 'warning' : 'warnings'}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2 text-sm pt-0">
        {count === 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">No concentration issues detected.</p>
            {largest && (
              <p className="text-sm text-muted-foreground">
                Largest position:{' '}
                <span className="font-mono text-foreground">{largest.ticker}</span>
                {' · '}
                <span className="tabular-nums">
                  {(largest.pctOfPortfolio * 100).toFixed(1)}%
                </span>
              </p>
            )}
            <Link
              to="/investments#concentration"
              className="inline-block text-sm text-primary underline hover:no-underline"
            >
              See full breakdown
            </Link>
          </div>
        ) : (
          <>
            {report.warnings.slice(0, 3).map((w, i) => {
              const chip = severityChip(w.severity);
              return (
                <div
                  key={`${w.type}-${w.ticker ?? w.assetClass ?? i}`}
                  className="flex items-start gap-2"
                >
                  <AlertTriangleIcon
                    className={`h-4 w-4 shrink-0 mt-0.5 ${severityColor(w.severity)}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words">{w.message}</span>
                  <span className={`${SEVERITY_CHIP_BASE} ${chip.className}`}>{chip.label}</span>
                </div>
              );
            })}
            <Link
              to="/investments#concentration"
              className="inline-block text-sm text-primary underline hover:no-underline"
            >
              See full breakdown
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Wave-5 frontend A+ #3: takes no props and its render is driven entirely by
// the useConcentration hook's memoized result, so a parent re-render (any
// other Dashboard pill changing, etc.) shouldn't recompute the card. The
// hook itself short-circuits when its upstream stores haven't changed.
const ConcentrationCardMemo = memo(ConcentrationCardImpl);
ConcentrationCardMemo.displayName = 'ConcentrationCard';

export { ConcentrationCardMemo as ConcentrationCard };
