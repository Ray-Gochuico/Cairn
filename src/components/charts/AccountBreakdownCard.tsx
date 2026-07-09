import { ArrowDown, ArrowUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CHART_NEUTRAL } from '@/components/charts/palette';
import type {
  AccountBreakdownRow,
  AccountBreakdownTotal,
} from '@/lib/account-breakdown';

export interface AccountBreakdownCardProps {
  /**
   * One entry per included account, in display order. Built by
   * computeAccountBreakdown() on the page — this component is purely
   * presentational and does no data fetching of its own.
   */
  rows: AccountBreakdownRow[];
  /** Portfolio totals (current value + change vs last month), from the helper. */
  total: AccountBreakdownTotal;
  /** Per-row swatch/segment colors, keyed by accountId (resolved on the page
   *  via colorForAccount so the account's accent override is honored). */
  colorByAccountId: Map<number, string>;
  /** "Investable only" toggle state + handler (owned by the page). */
  investableOnly: boolean;
  onToggleInvestableOnly: (next: boolean) => void;
  /**
   * The latest snapshot date across the included accounts (YYYY-MM-DD), shown
   * as an "as of" line. Null when no account has a snapshot.
   */
  asOfDate?: string | null;
  /**
   * Optional route for a "View holdings" link in the header. Preserves the
   * link the old Accounts card carried; omit it to drop the link entirely.
   */
  viewHoldingsTo?: string;
  /** Defaults to the app-wide whole-dollar currency formatter. */
  valueFormatter?: (n: number) => string;
}

/** "+10.0%" / "-3.4%" from a fraction (0.1 -> "+10.0%"). Mirrors GrowthCard. */
function formatPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** Whole-percent label for the stacked bar / row share (e.g. 0.5 -> "50%"). */
function formatShare(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/**
 * Signed change cell: "+$1,200 (+3.4%)" with an up/down arrow and
 * success/destructive color, mirroring GrowthCard's treatment. Renders an
 * em-dash (with a "builds after your first month" tooltip) when the change is
 * null — i.e. there's no on-or-before-last-month baseline yet — so we never
 * show a misleading $0 / NaN.
 */
function ChangeCell({
  changeAbs,
  changePct,
  valueFormatter,
}: {
  changeAbs: number | null;
  changePct: number | null;
  valueFormatter: (n: number) => string;
}) {
  if (changeAbs == null) {
    return (
      <span
        className="text-muted-foreground"
        title="Builds after your first month of history"
      >
        —
      </span>
    );
  }
  const isUp = changeAbs >= 0;
  const Arrow = isUp ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-1 tabular-nums',
        isUp ? 'text-success-foreground' : 'text-destructive-soft-foreground',
      )}
    >
      <Arrow className="h-3.5 w-3.5" aria-hidden />
      <span>
        {isUp ? '+' : ''}
        {valueFormatter(changeAbs)}
      </span>
      {changePct != null && (
        <span className="text-xs">({formatPct(changePct)})</span>
      )}
    </span>
  );
}

/**
 * "Portfolio by account" breakdown card. Presentational only — fed entirely by
 * props. Shows a 100%-stacked composition bar (account weights), a per-account
 * row list (swatch · name · % · value · change vs last month), and a header
 * summary (portfolio total + its own change vs last month).
 *
 * Sits where the old "Accounts" list lived on the Investments page and reuses
 * the same shadcn Card primitives + muted/foreground tokens, plus GrowthCard's
 * sign/color/arrow treatment, to stay visually consistent.
 */
export default function AccountBreakdownCard({
  rows,
  total,
  colorByAccountId,
  investableOnly,
  onToggleInvestableOnly,
  asOfDate,
  viewHoldingsTo,
  valueFormatter = formatCurrency,
}: AccountBreakdownCardProps) {
  // The bar + the denominator share the same guard the helper applies: with no
  // positive total there are no meaningful weights, so we hide the bar and let
  // the rows (which show "—" for pct) stand on their own.
  const hasPositiveTotal = total.currentValue > 0;
  // Only rows with a real share get a bar segment; null-pct rows (no snapshot,
  // or non-divisible total) contribute nothing to the 100% bar.
  const barSegments = rows.filter((r) => (r.pctOfTotal ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Portfolio by account</CardTitle>
            {asOfDate && (
              <div className="text-xs text-muted-foreground">as of {formatDate(asOfDate)}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {/* "Investable only" toggle. No shadcn Switch in this app, so we use
                a native checkbox + label — same control DonutEntityPicker uses. */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={investableOnly}
                onChange={(e) => onToggleInvestableOnly(e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
              Investable only
            </label>
            {viewHoldingsTo && (
              <Link
                to={viewHoldingsTo}
                className="text-sm underline text-muted-foreground hover:text-foreground"
              >
                View holdings
              </Link>
            )}
          </div>
        </div>

        {/* Header summary: portfolio total + change vs last month. */}
        <div className="space-y-1">
          <div className="text-3xl font-semibold tabular-nums">
            {valueFormatter(total.currentValue)}
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">vs last month</span>
            <ChangeCell
              changeAbs={total.changeAbs}
              changePct={total.changePct}
              valueFormatter={valueFormatter}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 100%-stacked composition bar — one segment per account, sized by its
            share. Hidden when the total isn't positive (nothing to weigh). */}
        {hasPositiveTotal && barSegments.length > 0 && (
          <div
            className="flex h-3 w-full overflow-hidden rounded-full"
            role="img"
            aria-label="Portfolio composition by account"
          >
            {barSegments.map((r) => (
              <div
                key={r.accountId}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(r.pctOfTotal ?? 0) * 100}%`,
                  background: colorByAccountId.get(r.accountId) ?? CHART_NEUTRAL,
                }}
                title={`${r.name} — ${formatShare(r.pctOfTotal ?? 0)}`}
              />
            ))}
          </div>
        )}

        {/* Row list. Mirrors the old Accounts card style: divide-y, tabular
            numerics, right-aligned value/change. */}
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No accounts yet.</div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={r.accountId}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ background: colorByAccountId.get(r.accountId) ?? CHART_NEUTRAL }}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {r.pctOfTotal != null ? formatShare(r.pctOfTotal) : '—'} of portfolio
                    </div>
                  </div>
                </div>
                <div className="shrink-0 space-y-0.5 text-right text-sm">
                  <div className="font-mono tabular-nums">
                    {r.currentValue != null ? valueFormatter(r.currentValue) : '—'}
                  </div>
                  <div className="text-xs">
                    <ChangeCell
                      changeAbs={r.changeAbs}
                      changePct={r.changePct}
                      valueFormatter={valueFormatter}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Gross / pre-tax caveat. One muted line — these balances aren't
            apples-to-apples across account tax treatments. */}
        <p className="text-xs text-muted-foreground">
          Balances are gross; pre-tax (Traditional) dollars aren't directly
          comparable to Roth/taxable.
        </p>
      </CardContent>
    </Card>
  );
}
