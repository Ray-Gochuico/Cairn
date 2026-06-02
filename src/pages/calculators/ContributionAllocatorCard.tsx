import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalculatorCard } from './CalculatorCard';
import { NumberField } from '@/components/calculators/NumberField';
import { StatTile } from '@/components/calculators/StatTile';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { AssetClass } from '@/types/enums';
import { valueHoldings } from '@/lib/holdings-value';
import { allocateContribution } from '@/lib/contribution-allocator';
import { formatCurrency } from '@/lib/format';

interface Props {
  cardId?: string;
  onHide?: (cardId: string) => void;
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

export function ContributionAllocatorCard({ cardId, onHide }: Props = {}) {
  const accounts = useAccountsStore((s) => s.accounts);
  const holdings = useHoldingsStore((s) => s.holdings);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const tickers = useTickersStore((s) => s.tickers);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    void useAccountsStore.getState().load();
    void useHoldingsStore.getState().load();
    void useSnapshotsStore.getState().load();
    void useTickersStore.getState().load();
    void useSettingsStore.getState().load();
  }, []);

  const [contribution, setContribution] = useState<number | null>(1000);

  const assetClassByTicker = useMemo(() => {
    const m = new Map<string, AssetClass>();
    for (const t of tickers) m.set(t.ticker, t.assetClass);
    return m;
  }, [tickers]);

  const latestPerAccount = useMemo(() => {
    const latest = new Map<number, { d: string; v: number }>();
    for (const s of snapshots) {
      const cur = latest.get(s.accountId);
      if (!cur || cur.d < s.snapshotDate) latest.set(s.accountId, { d: s.snapshotDate, v: s.totalValue });
    }
    const out = new Map<number, number>();
    for (const [id, { v }] of latest) out.set(id, v);
    return out;
  }, [snapshots]);

  const valuations = useMemo(
    () => valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker),
    [accounts, holdings, latestPerAccount, assetClassByTicker],
  );
  const householdTotal = useMemo(() => valuations.reduce((a, v) => a + v.value, 0), [valuations]);

  const classTargets = settings?.assetClassTargetAllocations ?? null;
  const result = useMemo(
    () => allocateContribution({ valuations, classTargets, householdTotal, cash: contribution ?? 0 }),
    [valuations, classTargets, householdTotal, contribution],
  );

  const hasTargets = (classTargets?.length ?? 0) > 0;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Contribution allocator"
      titleText="Contribution allocator"
      headline={hasTargets ? formatCurrency(result.totalAllocated) : '—'}
    >
      {!hasTargets ? (
        // UX H1: a REAL link to where targets are authored — not dead prose.
        <p className="text-sm text-muted-foreground">
          <Link to="/investments" className="text-primary hover:underline">
            Set asset-class targets on the Investments page
          </Link>{' '}
          to allocate a contribution toward them.
        </p>
      ) : (
        <div className="space-y-3">
          <NumberField
            id="alloc-contribution"
            label="Contribution"
            value={contribution}
            onChange={setContribution}
            suffix="$"
            step="100"
            min={0}
          />

          {result.unreachableWithoutSelling && (
            // UX M3: NAME the overweight class(es), don't bury the reason.
            <div
              role="note"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
            >
              {result.overweightClasses.length > 0 ? (
                <>
                  Already overweight {result.overweightClasses.map((c) => ASSET_CLASS_LABEL[c]).join(', ')} —
                  these get $0 because this is a cash-only, no-sell plan. Some targets can’t be reached without selling.
                </>
              ) : (
                <>
                  Some targets can’t be reached without selling — a holding is already over its within-class target, so
                  it gets $0 (cash-only, no-sell).
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <StatTile testId="allocator-total" label="Total allocated" value={formatCurrency(result.totalAllocated)} />
            <StatTile testId="allocator-cash-left" label="Cash left over" value={formatCurrency(result.cashLeftOver)} />
          </div>

          {/* DOLLARS ONLY (H1): Buy $ is the allocation — no Shares column. */}
          <div className="overflow-x-auto" data-testid="allocator-results">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 px-2">Class</th>
                  <th className="py-2 px-2 text-right">Buy $</th>
                  <th className="py-2 px-2 text-right">New %</th>
                  <th className="py-2 pl-2 text-right">Target %</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.ticker} className="border-b last:border-b-0">
                    <td className="py-2 pr-2 font-mono">{r.ticker}</td>
                    <td className="py-2 px-2 text-muted-foreground">{ASSET_CLASS_LABEL[r.assetClass]}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(r.buyDollars)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{(r.newPct * 100).toFixed(1)}%</td>
                    <td className="py-2 pl-2 text-right tabular-nums text-muted-foreground">
                      {r.targetPct != null ? `${(r.targetPct * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Finance L2: be explicit that this covers held positions only. */}
          <p className="text-xs text-muted-foreground">
            Approximate, using the latest snapshot per account, over held positions only
            (snapshot value is distributed by share count — no live prices, and accounts
            with no holdings, e.g. cash, aren’t included).
          </p>
        </div>
      )}
    </CalculatorCard>
  );
}
