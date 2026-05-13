import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { getDatabase } from '@/db/db';
import { AssetClass } from '@/types/enums';
import { monthsBetween } from '@/lib/business-days';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import DonutChartCard from '@/components/charts/DonutChartCard';
import BarChartCard from '@/components/charts/BarChartCard';
import type { Account, Holding, AccountSnapshot } from '@/types/schema';

/**
 * Investments page — Phase 2 visualization surface.
 *
 * For each holding, we look up its asset_class via the `tickers` table.
 * Tickers not in the seed list fall back to AssetClass.OTHER (the Phase 2
 * plan's stated stance — a Tickers admin tab lands in Phase 3). Holding
 * dollar value is approximated by distributing each account's latest
 * snapshot.totalValue proportionally across that account's holdings
 * (weighted by share count) — a deliberate simplification while
 * PriceCache.currentPrice still requires Yahoo connectivity.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  US_TOTAL_MARKET: 'US Total Market',
  US_LARGE_CAP: 'US Large Cap',
  US_MID_CAP: 'US Mid Cap',
  US_SMALL_CAP: 'US Small Cap',
  INTL_DEVELOPED: 'Intl Developed',
  EMERGING_MARKETS: 'Emerging Markets',
  US_BONDS: 'US Bonds',
  INTL_BONDS: 'Intl Bonds',
  TIPS: 'TIPS',
  REAL_ESTATE: 'Real Estate',
  COMMODITIES: 'Commodities',
  CRYPTO: 'Crypto',
  SINGLE_STOCK: 'Single Stock',
  CASH: 'Cash',
  OTHER: 'Other',
};

/**
 * Load asset_class for each ticker from the `tickers` table. Missing rows
 * fall back to AssetClass.OTHER. We use IN (?,?,...) rather than a
 * per-ticker query to keep this cheap when a portfolio has many tickers.
 */
async function loadTickerAssetClasses(tickers: string[]): Promise<Map<string, AssetClass>> {
  const result = new Map<string, AssetClass>();
  if (tickers.length === 0) return result;
  const placeholders = tickers.map(() => '?').join(',');
  const rows = await getDatabase().select<{ ticker: string; asset_class: string }>(
    `SELECT ticker, asset_class FROM tickers WHERE ticker IN (${placeholders})`,
    tickers,
  );
  for (const row of rows) {
    // The asset_class column has no DB-level CHECK, so we defend at the
    // read boundary — if a future ingestion writes an unrecognized value,
    // we fall back to OTHER rather than crash the page.
    const cls = row.asset_class as AssetClass;
    if (cls in ASSET_CLASS_LABEL) {
      result.set(row.ticker, cls);
    }
  }
  return result;
}

interface HoldingValuation {
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
 * here (their value still shows up in the per-account summary list).
 */
function valueHoldings(
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

function latestSnapshotPerAccount(
  snapshots: AccountSnapshot[],
): Map<number, number> {
  const latest = new Map<number, AccountSnapshot>();
  for (const s of snapshots) {
    const existing = latest.get(s.accountId);
    if (!existing || existing.snapshotDate < s.snapshotDate) {
      latest.set(s.accountId, s);
    }
  }
  const result = new Map<number, number>();
  for (const [accountId, snap] of latest.entries()) {
    result.set(accountId, snap.totalValue);
  }
  return result;
}

function aggregateByAssetClass(
  valuations: HoldingValuation[],
): { name: string; value: number }[] {
  const buckets = new Map<AssetClass, number>();
  for (const v of valuations) {
    buckets.set(v.assetClass, (buckets.get(v.assetClass) ?? 0) + v.value);
  }
  return [...buckets.entries()]
    .map(([cls, value]) => ({ name: ASSET_CLASS_LABEL[cls], value }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);
}

interface DriftRow {
  ticker: string;
  accountName: string;
  targetPct: number | null;
  actualPct: number;
  drift: number;
  value: number;
}

function computeDrift(valuations: HoldingValuation[]): DriftRow[] {
  const total = valuations.reduce((a, b) => a + b.value, 0);
  return valuations
    .map<DriftRow>((v) => {
      const actualPct = total === 0 ? 0 : v.value / total;
      const drift = v.holding.targetAllocationPct != null
        ? actualPct - v.holding.targetAllocationPct
        : 0;
      return {
        ticker: v.holding.ticker,
        accountName: v.accountName,
        targetPct: v.holding.targetAllocationPct,
        actualPct,
        drift,
        value: v.value,
      };
    })
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

function contributionsLast12Months(
  contributions: { date: string; amount: number }[],
  currentMonth: string,
): { month: string; amount: number }[] {
  // Build the 12-month window ending at currentMonth.
  const [y, m] = currentMonth.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y - 1, m - 1, 1));
  const fromYyyymm = fromDate.toISOString().slice(0, 7);
  const months = monthsBetween(fromYyyymm, currentMonth);
  const totals = new Map<string, number>(months.map((mm) => [mm, 0]));
  for (const c of contributions) {
    const mm = c.date.slice(0, 7);
    if (totals.has(mm)) {
      totals.set(mm, (totals.get(mm) ?? 0) + c.amount);
    }
  }
  return months.map((mm) => ({ month: mm, amount: totals.get(mm) ?? 0 }));
}

export default function Investments() {
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);

  useEffect(() => {
    loadAccounts();
    loadHoldings();
    loadSnapshots();
    loadContributions();
  }, [loadAccounts, loadHoldings, loadSnapshots, loadContributions]);

  const [assetClassByTicker, setAssetClassByTicker] = useState<Map<string, AssetClass>>(
    () => new Map(),
  );

  // Look up asset classes whenever the set of tickers changes. The tickers
  // table starts empty in Phase 2; this lookup gracefully resolves to an
  // empty map and every holding falls back to AssetClass.OTHER.
  useEffect(() => {
    const tickers = Array.from(new Set(holdings.map((h) => h.ticker))).sort();
    if (tickers.length === 0) {
      setAssetClassByTicker(new Map());
      return;
    }
    let cancelled = false;
    loadTickerAssetClasses(tickers).then((map) => {
      if (!cancelled) setAssetClassByTicker(map);
    }).catch(() => {
      if (!cancelled) setAssetClassByTicker(new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [holdings]);

  const latestPerAccount = useMemo(
    () => latestSnapshotPerAccount(snapshots),
    [snapshots],
  );

  const valuations = useMemo(
    () => valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker),
    [accounts, holdings, latestPerAccount, assetClassByTicker],
  );

  const allocation = useMemo(
    () => aggregateByAssetClass(valuations),
    [valuations],
  );

  const drift = useMemo(() => computeDrift(valuations), [valuations]);
  const driftWithTarget = useMemo(
    () => drift.filter((d) => d.targetPct != null),
    [drift],
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const contribSeries = useMemo(
    () => contributionsLast12Months(contributions, currentMonth),
    [contributions, currentMonth],
  );

  const accountSummary = useMemo(() => {
    return accounts.map((a) => ({
      account: a,
      latestValue: a.id != null ? (latestPerAccount.get(a.id) ?? 0) : 0,
    }));
  }, [accounts, latestPerAccount]);

  const hasAnyHolding = holdings.length > 0;
  const hasAnySnapshot = snapshots.length > 0;

  if (!hasAnyHolding && !hasAnySnapshot) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Investments</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Asset allocation, drift from your targets, and contribution trends.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Set up accounts and holdings in{' '}
            <Link to="/inputs/accounts" className="underline text-foreground">
              Inputs
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Investments</h1>
        <p className="text-sm text-muted-foreground">
          Allocation across asset classes, drift from your targets, and contribution trends.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {allocation.length > 0 ? (
          <DonutChartCard
            title="Asset allocation"
            subtitle="Approximate, using latest snapshot per account"
            data={allocation}
            valueFormatter={formatCurrency}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Asset allocation</CardTitle>
              <CardDescription>
                Approximate, using latest snapshot per account
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No holding values yet — confirm an account snapshot in the monthly window.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Target vs Actual</CardTitle>
            <CardDescription>
              Holdings with targets, sorted by absolute drift
            </CardDescription>
          </CardHeader>
          <CardContent>
            {driftWithTarget.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No target allocations set. Add target % per holding in Holdings.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                      <th className="py-2 pr-2">Ticker</th>
                      <th className="py-2 px-2 text-right">Target</th>
                      <th className="py-2 px-2 text-right">Actual</th>
                      <th className="py-2 pl-2 text-right">Drift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driftWithTarget.map((row) => (
                      <tr key={`${row.accountName}-${row.ticker}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-2 font-mono">{row.ticker}</td>
                        <td className="py-2 px-2 text-right">
                          {row.targetPct != null
                            ? `${(row.targetPct * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {(row.actualPct * 100).toFixed(1)}%
                        </td>
                        <td className={`py-2 pl-2 text-right ${
                          row.drift >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {row.drift >= 0 ? '+' : ''}
                          {(row.drift * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <BarChartCard
        title="Contributions (last 12 months)"
        subtitle="Sum of contributions per month"
        data={contribSeries}
        xKey="month"
        series={[{ dataKey: 'amount', label: 'Amount' }]}
        yFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Latest snapshot value per account</CardDescription>
        </CardHeader>
        <CardContent>
          {accountSummary.length === 0 ? (
            <div className="text-sm text-muted-foreground">No accounts yet.</div>
          ) : (
            <ul className="divide-y">
              {accountSummary.map(({ account, latestValue }) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <div className="font-medium">{account.name}</div>
                    {account.institution ? (
                      <div className="text-xs text-muted-foreground">
                        {account.institution}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono">{formatCurrency(latestValue)}</span>
                    <Link
                      to="/inputs/holdings"
                      className="text-sm underline text-muted-foreground hover:text-foreground"
                    >
                      View holdings
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
