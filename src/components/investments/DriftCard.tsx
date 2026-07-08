import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ClassTargetRow, HoldingTargetRow } from '@/lib/allocation-hierarchy';
import { ASSET_CLASS_LABEL } from '@/lib/asset-class-labels';
import { formatCurrency } from '@/lib/format';

/**
 * Target-vs-Actual (drift) card body — extracted 1:1 from the Investments
 * page cardRegistry (wave-7 W4). Both tables, the dual-basis reconciliation
 * caption, and the `class-row-*` / `holding-row-*` testids are byte-identical
 * to the inline body replaced (Investments.cards.test.tsx pins `class-row-*`;
 * Investments.test.tsx pins `holding-row-*`).
 */
export interface DriftCardProps {
  classRows: ClassTargetRow[];
  holdingRows: HoldingTargetRow[];
}

function DriftCardImpl({ classRows, holdingRows }: DriftCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Target vs Actual</CardTitle>
        <CardDescription>
          Approximate, using latest snapshot per account, over held positions
          only. Asset classes are household-level; holdings refine within
          their class.
        </CardDescription>
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
                    <th className="py-2 px-2 text-right">Invested</th>
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

        {/* ── By holding (within-class, aggregated per ticker across accounts) ── */}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">By holding</div>
          {/* UX H2/H3 + Finance M2 CAPTION — the dual-basis reconciliation note.
              Without it a user who typed VTI 30% sees the within-class basis
              render as 75% and thinks the app is wrong. The Target column below
              is rendered on the HOUSEHOLD basis (= targetValue / household), so
              Actual − Target = Drift reconciles cleanly in this table. */}
          <p className="text-xs text-muted-foreground mb-2">
            Targets shown as each holding’s share of its asset-class target,
            expressed as a % of your whole portfolio — so Actual − Target = Drift.
          </p>
          {holdingRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No holdings with values yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="By holding">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 px-2 text-right">Invested</th>
                    <th className="py-2 px-2 text-right">Actual</th>
                    <th className="py-2 px-2 text-right">Target</th>
                    <th className="py-2 pl-2 text-right">Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingRows.map((r) => {
                    // Reconciling identity: targetPct(household) = actualPct − driftPct
                    // (since driftPct = (actualValue − targetValue)/household and
                    // actualPct = actualValue/household). No extra state needed.
                    const targetPctHousehold = r.targetValue == null ? null : r.actualPct - r.driftPct;
                    return (
                      <tr key={r.ticker} data-testid={`holding-row-${r.ticker}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-2 font-mono">{r.ticker}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{formatCurrency(r.actualValue)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{(r.actualPct * 100).toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right tabular-nums">{targetPctHousehold != null ? `${(targetPctHousehold * 100).toFixed(1)}%` : '—'}</td>
                        <td className={`py-2 pl-2 text-right tabular-nums ${r.targetValue == null ? 'text-muted-foreground' : r.driftPct >= 0 ? 'text-success-foreground' : 'text-destructive-soft-foreground'}`}>
                          {r.targetValue == null ? '—' : `${r.driftPct >= 0 ? '+' : ''}${(r.driftPct * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const DriftCard = memo(DriftCardImpl);
DriftCard.displayName = 'DriftCard';
export default DriftCard;
