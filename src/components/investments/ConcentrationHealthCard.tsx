import { memo } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import {
  topEffectiveExposures,
  type ConcentrationReport,
  type ConcentrationWarning,
} from '@/lib/concentration';

/**
 * Concentration Health card body — extracted 1:1 from the Investments page
 * cardRegistry (wave-7 W4). OWNER CONSTRAINT: this is a protected
 * concentration-visibility surface (improve, never remove) — the warnings
 * list, "Why this matters" educational copy, "View in donut" anchor-scroll,
 * and Top-3 effective exposures (share-% readout) move byte-identically.
 * The #per-company/#allocation scroll anchors it targets are renderCardFlow
 * wrapper ids, unchanged by the decomposition.
 */

/**
 * Educational copy for each warning type, surfaced as a tooltip on the
 * Concentration Health section. Phase 3 keeps tooltips simple — a `title`
 * attribute renders a native browser tooltip; no popover library required.
 */
const CONCENTRATION_TOOLTIP: Record<ConcentrationWarning['type'], string> = {
  PER_TICKER_HIGH: "A single ticker's outsized share concentrates idiosyncratic risk.",
  PER_TICKER_SOFT: "Watch this ticker — it's getting concentrated.",
  PER_ASSET_CLASS_HIGH: 'Heavy weight in one asset class amplifies its drawdowns.',
  PER_ASSET_CLASS_SOFT: 'Asset-class exposure is approaching concentrated territory.',
  LEVERAGE_HIGH: 'Effective leverage means small moves cause big P&L swings.',
};

function severityColor(severity: ConcentrationWarning['severity']): string {
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
function severityChip(
  severity: ConcentrationWarning['severity'],
): { label: string; className: string } {
  switch (severity) {
    case 'HIGH': return { label: 'High', className: 'bg-destructive-soft text-destructive-soft-foreground' };
    case 'MEDIUM': return { label: 'Watch', className: 'bg-warning-soft text-warning-foreground' };
    case 'LOW':
    default: return { label: 'Note', className: 'bg-info-soft text-info-foreground' };
  }
}

export interface ConcentrationHealthCardProps {
  report: ConcentrationReport;
}

function ConcentrationHealthCardImpl({ report }: ConcentrationHealthCardProps) {
  return (
    <Card data-testid="concentration-section">
      <CardHeader>
        <CardTitle>
          <TermTooltip term="CONCENTRATION">Concentration</TermTooltip> Health
        </CardTitle>
        <CardDescription>
          Effective exposure after fund look-through and leverage. Warnings
          fire when a single ticker exceeds 25%, an asset class exceeds 60%,
          or total leverage exceeds 1.5x.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.warnings.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No concentration issues detected.
          </div>
        ) : (
          <ul className="space-y-3">
            {report.warnings.map((w, i) => {
              const chip = severityChip(w.severity);
              return (
              <li
                key={`${w.type}-${w.ticker ?? w.assetClass ?? i}`}
                className="flex items-start gap-3"
              >
                <AlertTriangleIcon
                  className={`h-5 w-5 shrink-0 mt-0.5 ${severityColor(w.severity)}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm">{w.message}</div>
                    <span className={`${SEVERITY_CHIP_BASE} ${chip.className}`}>{chip.label}</span>
                  </div>
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Why this matters
                    </summary>
                    <p className="text-xs text-muted-foreground mt-1">
                      {CONCENTRATION_TOOLTIP[w.type]}
                    </p>
                  </details>
                  {/* Anchor-scroll to the donut that visualizes this
                      warning's subject (ticker → per-company card;
                      asset class → allocation card). A slice-focus
                      pulse is a noted follow-up (needs a focus channel
                      on useDonutSelection). */}
                  {(w.ticker || w.assetClass) && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-primary hover:underline"
                      onClick={() =>
                        document
                          .getElementById(w.ticker ? 'per-company' : 'allocation')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                    >
                      View in donut
                    </button>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}

        {(() => {
          const top = topEffectiveExposures(report.perTicker, 3);
          if (top.length === 0) return null;
          return (
            <div className="mt-6 border-t pt-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Top 3 effective exposures
              </div>
              <ul className="space-y-1 text-sm">
                {top.map((t) => (
                  <li key={t.ticker} className="flex justify-between gap-2 tabular-nums">
                    <span className="font-mono">{t.ticker}</span>
                    <span className="text-muted-foreground">
                      {(t.pctOfPortfolio * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

const ConcentrationHealthCard = memo(ConcentrationHealthCardImpl);
ConcentrationHealthCard.displayName = 'ConcentrationHealthCard';
export default ConcentrationHealthCard;
