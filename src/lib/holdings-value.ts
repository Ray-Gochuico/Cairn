import { AssetClass } from '@/types/enums';
import type { Account, Holding } from '@/types/schema';

/**
 * Holding annotated with an approximated dollar value. The value is derived
 * by distributing each account's latest snapshot.totalValue proportionally
 * across that account's holdings, weighted by share count — a deliberate
 * simplification while PriceCache.currentPrice still requires Yahoo
 * connectivity. Tickers with no asset_class lookup fall back to
 * AssetClass.OTHER, matching the Investments page's defensive read pattern.
 */
export interface HoldingValuation {
  holding: Holding;
  /** Approximated dollar value: account snapshot × holding's share-of-account by shareCount. */
  value: number;
  assetClass: AssetClass;
  accountName: string;
}

/**
 * For each holding, compute an approximated dollar value: distribute the
 * latest snapshot.totalValue per account proportionally across that
 * account's holdings, weighted by share count. Accounts with no snapshot
 * contribute zero. Accounts with snapshots but no holdings are ignored
 * here (their value still shows up in the per-account summary list elsewhere).
 *
 * This is the shared computation used by both the Investments allocation
 * donut and the concentration hook — keep semantics behaviour-preserving
 * when changing it; both surfaces consume the same `value` field.
 */
export function valueHoldings(
  accounts: Account[],
  holdings: Holding[],
  latestPerAccount: Map<number, number>,
  assetClassByTicker: Map<string, AssetClass>,
): HoldingValuation[] {
  const accountNames = new Map<number, string>();
  for (const a of accounts) {
    if (a.id != null) accountNames.set(a.id, a.name);
  }

  const result: HoldingValuation[] = [];
  // Group holdings by account.
  const byAccount = new Map<number, Holding[]>();
  for (const h of holdings) {
    const list = byAccount.get(h.accountId) ?? [];
    list.push(h);
    byAccount.set(h.accountId, list);
  }

  for (const [accountId, accountHoldings] of byAccount.entries()) {
    const snapshotValue = latestPerAccount.get(accountId) ?? 0;
    const totalShares = accountHoldings.reduce((a, b) => a + b.shareCount, 0);
    for (const h of accountHoldings) {
      const value = totalShares === 0
        ? 0
        : (h.shareCount / totalShares) * snapshotValue;
      result.push({
        holding: h,
        value,
        assetClass: assetClassByTicker.get(h.ticker) ?? AssetClass.OTHER,
        accountName: accountNames.get(accountId) ?? `Account #${accountId}`,
      });
    }
  }

  return result;
}
