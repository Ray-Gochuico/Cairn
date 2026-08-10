import type { AccountPositions, PositionRow, PositionsResult } from '@/lib/positions';
import { formatCurrency, formatCurrencyCents } from '@/lib/format';

const DASH = '—';

/** SQLite CURRENT_TIMESTAMP is UTC ('YYYY-MM-DD HH:MM:SS'); a bare
 * `new Date(s)` would parse it as LOCAL and shift the instant by the
 * timezone offset (D-PT13). Rendered per the house instant convention
 * (toLocaleString medium/short — the FreshnessBadge precedent). */
function formatFetchedAt(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** '+$55.00' / '−$145.00' (TRUE MINUS U+2212 — the formatSignedCurrency
 * contract, cents grain per D-PT10) / '$0.00' for a true zero. */
function signedCents(v: number): string {
  if (v > 0) return `+${formatCurrencyCents(v)}`;
  if (v < 0) return `−${formatCurrencyCents(Math.abs(v))}`;
  return formatCurrencyCents(0);
}

function signedPctParen(v: number): string {
  const pct = (Math.abs(v) * 100).toFixed(1);
  if (v > 0) return `(+${pct}%)`;
  if (v < 0) return `(−${pct}%)`;
  return `(${pct}%)`;
}

function deltaColor(v: number): string {
  if (v > 0) return 'text-success-foreground';
  if (v < 0) return 'text-destructive-soft-foreground';
  return 'text-muted-foreground';
}

function DeltaCell({ value, pct }: { value: number | null; pct: number | null }) {
  if (value === null) return <>{DASH}</>;
  return (
    <span className={deltaColor(value)}>
      {signedCents(value)}{' '}
      {pct !== null && <span className="text-muted-foreground font-normal">{signedPctParen(pct)}</span>}
    </span>
  );
}

function Week52Cell({ row }: { row: PositionRow }) {
  // Spec (D-P4 revised): either fetched field null → "—". A fetched range on
  // an unpriced row renders labels + track without the marker (D-PT3).
  if (row.week52Low === null || row.week52High === null) return <>{DASH}</>;
  return (
    <div className="flex items-center gap-2 min-w-[10rem]">
      <span className="text-xs tabular-nums text-muted-foreground">{formatCurrencyCents(row.week52Low)}</span>
      <div className="relative h-1 flex-1 rounded-full bg-muted" aria-hidden="true">
        {row.week52MarkerPct !== null && (
          <div
            data-testid={`week52-marker-${row.key}`}
            className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-sm bg-foreground"
            style={{ left: `${row.week52MarkerPct * 100}%` }}
          />
        )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{formatCurrencyCents(row.week52High)}</span>
    </div>
  );
}

function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3);
}

function AccountTable({ account }: { account: AccountPositions }) {
  return (
    <div data-testid={`positions-account-${account.accountId}`}>
      <div className="text-sm font-medium mb-1">{account.accountName}</div>
      {/* Column priority (spec): Symbol first; under overflow the RIGHTMOST
          columns clip first — 52-week range, then Cost basis / Quantity.
          The delta/value/% columns are the point and sit left. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={`Positions — ${account.accountName}`}>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
              <th className="py-2 pr-2">Symbol</th>
              <th className="py-2 px-2 text-right">Last price</th>
              <th className="py-2 px-2 text-right">Since last refresh</th>
              <th className="py-2 px-2 text-right">Total gain/loss</th>
              <th className="py-2 px-2 text-right">Current value</th>
              <th className="py-2 px-2 text-right">% of account</th>
              <th className="py-2 px-2 text-right">Quantity</th>
              <th className="py-2 px-2 text-right">Cost basis</th>
              <th className="py-2 pl-2">52-week range</th>
            </tr>
          </thead>
          <tbody>
            {account.rows.map((r) => (
              <tr key={r.key} data-testid={`position-row-${r.key}`} className="border-b">
                <td className="py-2 pr-2 align-top">
                  <div className="font-mono font-semibold">{r.ticker}</div>
                  {r.name !== null && (
                    <div className="text-xs text-muted-foreground truncate max-w-[16rem]">{r.name}</div>
                  )}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {r.lastPrice === null ? DASH : formatCurrencyCents(r.lastPrice)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  <DeltaCell value={r.sinceRefreshValue} pct={r.sinceRefreshPct} />
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  <DeltaCell value={r.totalGainValue} pct={r.totalGainPct} />
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {r.currentValue === null ? DASH : formatCurrency(r.currentValue)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {r.pctOfAccount === null ? DASH : `${(r.pctOfAccount * 100).toFixed(1)}%`}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">{formatQuantity(r.quantity)}</td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {r.costBasis === null ? (
                    DASH
                  ) : (
                    <>
                      <div>{formatCurrency(r.costBasis)}</div>
                      {r.costBasisPerShare !== null && (
                        <div className="text-xs text-muted-foreground">
                          {formatCurrencyCents(r.costBasisPerShare)}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="py-2 pl-2 align-middle">
                  <Week52Cell row={r} />
                </td>
              </tr>
            ))}
            <tr data-testid={`positions-total-${account.accountId}`} className="font-medium">
              <td className="py-2 pr-2">Account total</td>
              <td className="py-2 px-2" />
              <td className="py-2 px-2 text-right tabular-nums">
                {account.totalSinceRefresh === null ? (
                  DASH
                ) : (
                  <span className={deltaColor(account.totalSinceRefresh)}>
                    {signedCents(account.totalSinceRefresh)}
                  </span>
                )}
              </td>
              <td className="py-2 px-2" />
              <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                {/* m1: when the total is null AND unpriced rows exist, the
                    CP-6 suffix renders ALONE (it carries the count; CP-8
                    explains the refresh path) — a null-total dash composed
                    with the suffix read as "— — excludes…". Dash alone only
                    when null with no unpriced rows (branch totality). */}
                {account.totalValue !== null && formatCurrency(account.totalValue)}
                {account.totalValue === null && account.unpricedCount === 0 && DASH}
                {account.unpricedCount > 0 && (
                  <span className="text-muted-foreground font-normal">
                    {' '}— excludes {account.unpricedCount} without a price
                  </span>
                )}
              </td>
              <td className="py-2 px-2" colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The Positions half of the "Allocation & positions" card (2026-08-09 design
 * spec, D-P1..D-P6): account-grouped, MARKET basis (last cached price ×
 * shares), strict "—" null rules — never $0 for unknown. Presentation only;
 * all math lives in buildPositions (src/lib/positions.ts).
 */
export default function PositionsSection({ positions }: { positions: PositionsResult }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Positions</div>
      {positions.accounts.length === 0 ? (
        <div className="text-sm text-muted-foreground">No holdings with values yet.</div>
      ) : (
        <>
          {/* CP-4 — the dual-basis reconciliation note (D-P3). */}
          <p className="text-xs text-muted-foreground mb-1">
            Values in Positions use your last-fetched prices × shares. Account totals
            elsewhere in the app use your entered snapshots. Cost basis is entered per
            holding on the Holdings form.
          </p>
          {/* CP-3 / CP-8 — the as-of honesty line (derived from the table's own
              price rows, NOT settings.lastRefreshAt — D-P6). Withheld until the
              price SELECT has resolved (m3): rendering CP-8 off the initial
              empty state flashed "No cached prices yet" falsely for one frame
              for users WITH cached prices. */}
          {positions.pricesResolved && (
            <p className="text-xs text-muted-foreground mb-2" data-testid="positions-as-of">
              {positions.asOfUtc !== null
                ? `Prices as of ${formatFetchedAt(positions.asOfUtc)} — updated only when you refresh.`
                : 'No cached prices yet — prices fill in when you refresh market data.'}
            </p>
          )}
          <div className="space-y-4">
            {positions.accounts.map((a) => (
              <AccountTable key={a.accountId} account={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
