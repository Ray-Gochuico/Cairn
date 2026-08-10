import type { Holding } from '@/types/schema';

/**
 * Positions-table builder (2026-08-09 design spec, D-P1..D-P6).
 *
 * MARKET basis: last cached price × shares — deliberately different from
 * valueHoldings' snapshot-spread basis (D-P3). valueHoldings is FROZEN
 * (donuts + concentration consume it); this module must never import it.
 * Pure and CLOCK-FREE: no DB, no new Date(), no network. The 52-week range
 * is a fetched fact carried on the ticker (D-P4 revised), not derived here.
 */

/** Raw price_cache row as SELECTed (snake_case fetched_at preserved). */
export interface PriceCacheRow {
  ticker: string;
  date: string; // 'YYYY-MM-DD'
  price: number;
  /** SQLite CURRENT_TIMESTAMP — UTC 'YYYY-MM-DD HH:MM:SS' (see D-PT13). */
  fetched_at: string;
}

/** Per-ticker display facts sourced from the tickers store (D-PT1). */
export interface TickerPositionInfo {
  name: string | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
}

export interface PositionRow {
  /** String(holding.id) — testid + React key (D-PT5). */
  key: string;
  ticker: string;
  name: string | null;
  quantity: number;
  costBasis: number | null;
  costBasisPerShare: number | null;
  lastPrice: number | null;
  lastPriceDate: string | null;
  currentValue: number | null;
  sinceRefreshValue: number | null;
  sinceRefreshPct: number | null; // fraction
  totalGainValue: number | null;
  totalGainPct: number | null; // fraction
  pctOfAccount: number | null; // fraction, priced-only denominator
  /** Fetched 52-week range (D-P4 revised): both null unless BOTH fields
   * were fetched (spec: either null → "—"). */
  week52Low: number | null;
  week52High: number | null;
  /** Marker fraction 0..1 (clamped); null when the range is absent OR the
   * row has no last price to place (D-PT3). */
  week52MarkerPct: number | null;
}

export interface AccountPositions {
  accountId: number;
  accountName: string;
  /** Priced rows by value desc, then unpriced by ticker A→Z (D-PT11). */
  rows: PositionRow[];
  /** Sum of priced rows; null when NO row is priced — never a fake $0. */
  totalValue: number | null;
  /** Sum of sinceRefreshValue over rows that have one; null when none (D-PT4). */
  totalSinceRefresh: number | null;
  unpricedCount: number;
}

export interface PositionsResult {
  accounts: AccountPositions[];
  /** Lexical max fetched_at across held tickers' rows; null when no prices. */
  asOfUtc: string | null;
  /** False while the page's price SELECT has not yet resolved (priceRows
   * null) — gates the as-of caption so "No cached prices yet" (CP-8) never
   * flashes falsely for users WITH cached prices (m3). Rows still build
   * (dashed) during that frame; only the caption is gated. */
  pricesResolved: boolean;
}

export function buildPositions(
  accounts: ReadonlyArray<{ id?: number | null; name: string }>,
  holdings: Holding[],
  tickerInfo: ReadonlyMap<string, TickerPositionInfo>,
  priceRows: PriceCacheRow[] | null,
): PositionsResult {
  // null = the SELECT has not resolved yet (m3): build rows as unpriced but
  // mark the result unresolved so the component withholds the as-of caption.
  const pricesResolved = priceRows !== null;
  const resolvedRows = priceRows ?? [];
  // Per-ticker rows sorted by date asc. PK (ticker, date) guarantees distinct
  // dates; re-sort defensively rather than trusting SELECT order.
  const byTicker = new Map<string, PriceCacheRow[]>();
  for (const r of resolvedRows) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push(r);
    byTicker.set(r.ticker, list);
  }
  for (const list of byTicker.values()) list.sort((x, y) => (x.date < y.date ? -1 : 1));

  const toRow = (h: Holding, idx: number): PositionRow => {
    const rows = byTicker.get(h.ticker) ?? [];
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const lastPrice = latest === null ? null : latest.price;
    const currentValue = latest === null ? null : latest.price * h.shareCount;
    const sinceRefreshValue =
      latest !== null && prev !== null ? (latest.price - prev.price) * h.shareCount : null;
    const sinceRefreshPct =
      latest !== null && prev !== null && prev.price > 0
        ? (latest.price - prev.price) / prev.price
        : null;
    const totalGainValue =
      currentValue !== null && h.costBasis != null ? currentValue - h.costBasis : null;
    const totalGainPct =
      totalGainValue !== null && h.costBasis != null && h.costBasis > 0
        ? totalGainValue / h.costBasis
        : null;
    const costBasisPerShare =
      h.costBasis != null && h.shareCount > 0 ? h.costBasis / h.shareCount : null;

    // 52-week range (D-P4 revised): fetched ticker facts, not derived.
    // Spec: either field null → the whole cell is "—" (normalize both null).
    const fetched = tickerInfo.get(h.ticker);
    const hasRange =
      fetched != null && fetched.fiftyTwoWeekLow !== null && fetched.fiftyTwoWeekHigh !== null;
    const week52Low = hasRange ? fetched.fiftyTwoWeekLow : null;
    const week52High = hasRange ? fetched.fiftyTwoWeekHigh : null;
    let week52MarkerPct: number | null = null;
    if (week52Low !== null && week52High !== null && lastPrice !== null) {
      week52MarkerPct =
        week52High > week52Low
          ? Math.min(1, Math.max(0, (lastPrice - week52Low) / (week52High - week52Low)))
          : 0.5;
    }

    return {
      key: h.id != null ? String(h.id) : `${h.ticker}#${idx}`,
      ticker: h.ticker,
      name: fetched?.name ?? null,
      quantity: h.shareCount,
      costBasis: h.costBasis ?? null,
      costBasisPerShare,
      lastPrice,
      lastPriceDate: latest === null ? null : latest.date,
      currentValue,
      sinceRefreshValue,
      sinceRefreshPct,
      totalGainValue,
      totalGainPct,
      pctOfAccount: null, // filled per account below
      week52Low,
      week52High,
      week52MarkerPct,
    };
  };

  const holdingsByAccount = new Map<number, Holding[]>();
  for (const h of holdings) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }

  const out: AccountPositions[] = [];
  for (const a of accounts) {
    if (a.id == null) continue;
    const hs = holdingsByAccount.get(a.id) ?? [];
    if (hs.length === 0) continue; // D-PT12: no empty sections
    const rows = hs.map(toRow);
    const priced = rows.filter((r) => r.currentValue !== null);
    const unpriced = rows.filter((r) => r.currentValue === null);
    priced.sort((x, y) => y.currentValue! - x.currentValue!);
    unpriced.sort((x, y) => (x.ticker < y.ticker ? -1 : x.ticker > y.ticker ? 1 : 0));
    const pricedSum = priced.reduce((s, r) => s + r.currentValue!, 0);
    for (const r of priced) {
      r.pctOfAccount = pricedSum > 0 ? r.currentValue! / pricedSum : null;
    }
    const withDelta = priced.filter((r) => r.sinceRefreshValue !== null);
    out.push({
      accountId: a.id,
      accountName: a.name,
      rows: [...priced, ...unpriced],
      totalValue: priced.length > 0 ? pricedSum : null,
      totalSinceRefresh:
        withDelta.length > 0 ? withDelta.reduce((s, r) => s + r.sinceRefreshValue!, 0) : null,
      unpricedCount: unpriced.length,
    });
  }

  // As-of (CP-3, D-P6): lexical max fetched_at over rows of HELD tickers —
  // the 'YYYY-MM-DD HH:MM:SS' format makes lexical order chronological.
  const held = new Set(holdings.map((h) => h.ticker));
  let asOfUtc: string | null = null;
  for (const r of resolvedRows) {
    if (held.has(r.ticker) && (asOfUtc === null || r.fetched_at > asOfUtc)) asOfUtc = r.fetched_at;
  }

  return { accounts: out, asOfUtc, pricesResolved };
}
