import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ClassTargetRow } from '@/lib/allocation-hierarchy';
import type { PositionsResult } from '@/lib/positions';
import PositionsSection from '@/components/investments/PositionsSection';
import { ASSET_CLASS_LABEL } from '@/lib/asset-class-labels';
import { formatCurrency } from '@/lib/format';

/**
 * "Allocation & positions" card body (D-P5 rename; card id stays `drift` —
 * saved layouts key on it). The class-drift table is byte-identical to the
 * wave-7 extraction except its "Invested" header, renamed "Value" (CP-9);
 * `class-row-*` testids preserved. The old By-holding table and its
 * `holding-row-*` testids are retired deliberately (D-PT5), replaced by the
 * account-grouped, market-basis PositionsSection (2026-08-09 spec D-P1..D-P6).
 */
export interface DriftCardProps {
  classRows: ClassTargetRow[];
  /** Positions table (2026-08-09 spec) — replaced the By-holding drift table (D-P1). */
  positions: PositionsResult;
  /** Wave A C16: person-view scope declaration (targets are household
   *  settings; Actual follows the view) — muted line under the description. */
  scopeCaption?: string;
}

function DriftCardImpl({ classRows, positions, scopeCaption }: DriftCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Allocation & positions</CardTitle>
        <CardDescription>
          Asset-class drift is approximate, using latest snapshot per account,
          over held positions only. Asset classes are household-level.
        </CardDescription>
        {scopeCaption && <CardDescription>{scopeCaption}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── By asset class (household) ── */}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">By asset class</div>
          {classRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No holdings yet. Set asset-class targets above to track drift.
            </div>
          ) : (
            // Column priority (narrow → wide): Asset class + Drift always
            // visible (pinned ends); Target, then Actual, then Invested are
            // the first to scroll under overflow-x-auto. Drift is the point.
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="By asset class">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-2">Asset class</th>
                    <th className="py-2 px-2 text-right">Value</th>
                    <th className="py-2 px-2 text-right">Actual</th>
                    <th className="py-2 px-2 text-right">Target</th>
                    <th className="py-2 pl-2 text-right">Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((r) => (
                    <tr key={r.assetClass} data-testid={`class-row-${r.assetClass}`} className="border-b last:border-b-0">
                      <td className="py-2 pr-2">{ASSET_CLASS_LABEL[r.assetClass]}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{formatCurrency(r.actualValue)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{(r.actualPct * 100).toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums">{r.targetPct != null ? `${(r.targetPct * 100).toFixed(1)}%` : '—'}</td>
                      <td className={`py-2 pl-2 text-right tabular-nums ${r.targetPct == null ? 'text-muted-foreground' : r.driftPct >= 0 ? 'text-success-foreground' : 'text-destructive-soft-foreground'}`}>
                        {r.targetPct == null ? '—' : `${r.driftPct >= 0 ? '+' : ''}${(r.driftPct * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Positions (account-grouped, MARKET basis — 2026-08-09 spec D-P1..D-P6) ── */}
        <PositionsSection positions={positions} />
      </CardContent>
    </Card>
  );
}

const DriftCard = memo(DriftCardImpl);
DriftCard.displayName = 'DriftCard';
export default DriftCard;
