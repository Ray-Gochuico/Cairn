import { useMemo } from 'react';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { computeConcentration, type ConcentrationReport } from '@/lib/concentration';
import { valueHoldings } from '@/lib/holdings-value';
import type { AssetClass, AccountSnapshot } from '@/types/schema';

/**
 * Latest snapshot per account by snapshotDate. ISO date strings sort
 * lexicographically, so a string compare picks the chronologically latest.
 * Mirrors the helpers in Investments.tsx and Dashboard.tsx — kept inline
 * here so the hook is self-contained and doesn't introduce a cross-file
 * coupling that the existing pages don't already have.
 */
function latestSnapshotPerAccount(snapshots: AccountSnapshot[]): Map<number, number> {
  const winner = new Map<number, AccountSnapshot>();
  for (const s of snapshots) {
    const prev = winner.get(s.accountId);
    if (!prev || s.snapshotDate > prev.snapshotDate) {
      winner.set(s.accountId, s);
    }
  }
  const result = new Map<number, number>();
  for (const [accountId, snap] of winner.entries()) {
    result.set(accountId, snap.totalValue);
  }
  return result;
}

/**
 * Compose stores → concentration computation. Pulls accounts, holdings,
 * snapshots, tickers, and fund-holdings out of zustand, runs the shared
 * `valueHoldings` math, then hands a clean `(holdings, tickers, fundHoldings,
 * totalPortfolioValue)` shape to `computeConcentration`. Memoised so the
 * report only recomputes when one of the source stores actually changes —
 * the Investments page's Concentration Health section and the Dashboard
 * card both render off the same call.
 *
 * Consumer components are responsible for calling `load()` on the tickers
 * and fund-holdings stores when they mount; otherwise this returns a report
 * built from empty data (zero warnings, zero exposures). Dashboard and
 * Investments already do this in their `useEffect` mount blocks.
 *
 * DECISION (2026-07, Wave 1 review Minor 4): concentration percentages
 * DELIBERATELY include accounts flagged `excludedFromNetWorth`. These are
 * RISK-EXPOSURE views ("how concentrated is the money I actually hold"),
 * not wealth aggregates — an excluded account's AAPL position still moves
 * with AAPL. Net-worth surfaces filter excluded accounts; this hook (and
 * the allocation views built on the same valueHoldings pipeline) must not.
 */
export function useConcentration(): ConcentrationReport {
  const holdings = useHoldingsStore((s) => s.holdings);
  const accounts = useAccountsStore((s) => s.accounts);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const tickers = useTickersStore((s) => s.tickers);
  const fundHoldings = useFundHoldingsStore((s) => s.fundHoldings);

  return useMemo(() => {
    const tickerMap = new Map(
      tickers.map((t) => [
        t.ticker,
        {
          assetClass: t.assetClass,
          leverageFactor: t.leverageFactor,
          direction: t.direction,
        },
      ]),
    );
    const assetClassByTicker = new Map<string, AssetClass>(
      tickers.map((t) => [t.ticker, t.assetClass]),
    );
    const latestPerAccount = latestSnapshotPerAccount(snapshots);
    const valuations = valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker);

    const holdingsArr = valuations.map((v) => ({ ticker: v.holding.ticker, value: v.value }));
    const totalPortfolioValue = holdingsArr.reduce((a, b) => a + b.value, 0);

    const fundMap = new Map<string, { symbol: string; weight: number }[]>();
    for (const fh of fundHoldings) {
      const rows = fundMap.get(fh.fundTicker) ?? [];
      rows.push({ symbol: fh.holdingTicker, weight: fh.weight });
      fundMap.set(fh.fundTicker, rows);
    }

    return computeConcentration({
      holdings: holdingsArr,
      tickers: tickerMap,
      fundHoldings: fundMap,
      totalPortfolioValue,
    });
  }, [holdings, accounts, snapshots, tickers, fundHoldings]);
}
