import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  DEFAULT_POSITIONS_SORT, sortPositionRows,
  type AccountPositions, type PositionRow, type PositionsResult,
  type PositionsSort, type PositionsSortKey,
} from '@/lib/positions';
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

/** First click on an inactive header: symbol reads A→Z, numbers read
 * biggest-first (the Fidelity muscle memory); re-click toggles (D-WB10). */
const SORT_INITIAL_DIR: Record<PositionsSortKey, 'asc' | 'desc'> = {
  symbol: 'asc', lastPrice: 'desc', dayChange: 'desc', sinceRefresh: 'desc',
  totalGain: 'desc', currentValue: 'desc', pctOfAccount: 'desc',
  quantity: 'desc', costBasis: 'desc',
};

function SortableHeader({ label, sortKey, sort, onSort, className }: {
  label: string;
  sortKey: PositionsSortKey;
  sort: PositionsSort;
  onSort: (next: PositionsSort) => void;
  className: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        // Tailwind preflight sets `text-transform: none` on <button>, so the
        // header row's `uppercase` does NOT inherit — restate it here.
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
        onClick={() =>
          onSort(
            active
              ? { key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
              : { key: sortKey, dir: SORT_INITIAL_DIR[sortKey] },
          )
        }
      >
        {label}
        {active &&
          (sort.dir === 'asc' ? (
            <ChevronUp aria-hidden className="h-3 w-3" />
          ) : (
            <ChevronDown aria-hidden className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

function AccountTable({ account, sort, onSort }: {
  account: AccountPositions;
  sort: PositionsSort;
  onSort: (next: PositionsSort) => void;
}) {
  const rows = sortPositionRows(account.rows, sort);
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
              <SortableHeader label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} className="py-2 pr-2" />
              <SortableHeader label="Last price" sortKey="lastPrice" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Day change" sortKey="dayChange" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Since last refresh" sortKey="sinceRefresh" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Total gain/loss" sortKey="totalGain" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Current value" sortKey="currentValue" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="% of account" sortKey="pctOfAccount" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Quantity" sortKey="quantity" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              <SortableHeader label="Cost basis" sortKey="costBasis" sort={sort} onSort={onSort} className="py-2 px-2 text-right" />
              {/* Not sortable: a range has no honest scalar (D-WB8 / CP-W9). */}
              <th className="py-2 pl-2">52-week range</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
                  <DeltaCell value={r.dayChangeValue} pct={r.dayChangePct} />
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
                      {/* "/ share" per the Ray-approved mockup ("$234.96 / share") —
                          mockup-approved renderings outrank the plan's bare-figure
                          sketch. 52-week labels + Last price stay unitless as mocked. */}
                      {r.costBasisPerShare !== null && (
                        <div className="text-xs text-muted-foreground">
                          {formatCurrencyCents(r.costBasisPerShare)} / share
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
                {account.totalDayChange === null ? (
                  DASH
                ) : (
                  <span className={deltaColor(account.totalDayChange)}>
                    {signedCents(account.totalDayChange)}
                  </span>
                )}
              </td>
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
 * Wave B: sortable headers (one section-wide sort, unpriced pinned last) +
 * fetched Day change — as of the last refresh's market day, never "today"
 * (CP-W2 carries the honesty).
 */
export default function PositionsSection({ positions }: { positions: PositionsResult }) {
  // ONE sort for the whole section, applied within each account group
  // (D-WB1). Ephemeral by design — reload restores the default (= the
  // v1.4.0 order); persistence is a filed chip, not a hidden behavior.
  const [sort, setSort] = useState<PositionsSort>(DEFAULT_POSITIONS_SORT);
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
                ? `Prices and day change as of ${formatFetchedAt(positions.asOfUtc)} — updated only when you refresh.`
                : 'No cached prices yet — prices fill in when you refresh market data.'}
            </p>
          )}
          <div className="space-y-4">
            {positions.accounts.map((a) => (
              <AccountTable key={a.accountId} account={a} sort={sort} onSort={setSort} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
