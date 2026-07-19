import { useEffect, useMemo } from 'react';
import { CalculatorCard, EmptyMeaning, RailReset } from './CalculatorCard';
import { NumberField } from '@/components/calculators/NumberField';
import { StatTile } from '@/components/calculators/StatTile';
import { CalcTable, CalcRow, type CalcColumn } from '@/components/calculators/CalcTable';
import { useCalculatorState } from '@/lib/calculator-state';
import { useLocalToday } from '@/lib/use-local-today';
import { typicalMonthlyContribution } from '@/lib/typical-contribution';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { AssetClass } from '@/types/enums';
import { valueHoldings } from '@/lib/holdings-value';
import { allocateContribution } from '@/lib/contribution-allocator';
import { classTargetVsActual } from '@/lib/allocation-hierarchy';
import { formatCurrency } from '@/lib/format';
import { InlineLink } from '@/components/calculators/InlineLink';

interface Props {
  cardId?: string;
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

const BUY_COLUMNS: CalcColumn[] = [
  { key: 'ticker', header: 'Ticker' },
  { key: 'buy', header: 'Buy $', numeric: true },
  { key: 'new', header: 'New %', numeric: true },
  { key: 'target', header: 'Target %', numeric: true },
];

export function ContributionAllocatorCard({ cardId }: Props = {}) {
  const accounts = useAccountsStore((s) => s.accounts);
  const holdings = useHoldingsStore((s) => s.holdings);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const tickers = useTickersStore((s) => s.tickers);
  const settings = useSettingsStore((s) => s.settings);
  const contributions = useContributionsStore((s) => s.contributions);
  const todayIso = useLocalToday();

  useEffect(() => {
    // Load the portfolio stores this card needs that CalculatorsLayout does NOT
    // already hydrate (the layout loads snapshots/contributions/loans/equity +
    // persons/dependents). accounts/holdings/tickers/settings are this card's
    // own concern — load them here so a deep-link to /calculators populates the
    // allocator. Snapshots are intentionally NOT re-loaded (the layout owns
    // that single hydration — see CalculatorsLayout's cold-boot sentinel test).
    void useAccountsStore.getState().load();
    void useHoldingsStore.getState().load();
    void useTickersStore.getState().load();
    void useSettingsStore.getState().load();
  }, []);

  // D4 (Wave 18): the prefill is the rolling-12-month typical monthly
  // contribution — the SAME window the FI card's annualContribution uses,
  // so the two cards' derived figures agree. The hardcoded $1,000 demo
  // value is dead: no history ⇒ blank field + an honest prompt. The layout
  // already hydrates contributions.
  const defaults = useMemo(
    () => ({ contribution: typicalMonthlyContribution(contributions, todayIso) }),
    [contributions, todayIso],
  );
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(
    cardId ?? 'contribution-allocator',
    defaults,
  );
  const contribution = values.contribution;

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

  // Finance M3: one-sided tracking error = ½·Σ|drift| (the fraction of the
  // portfolio that would have to move to hit every target; bounded [0,1]). A
  // raw Σ|drift| double-counts (over in one class == under in another).
  const trackingError = (rows: { driftPct: number }[]) =>
    rows.reduce((a, r) => a + Math.abs(r.driftPct), 0) / 2;

  const driftBefore = useMemo(
    () => trackingError(classTargetVsActual(valuations, classTargets)),
    [valuations, classTargets],
  );

  const driftAfter = useMemo(() => {
    // Aggregate this contribution's buys by CLASS, then re-measure with the
    // class aggregates bumped (households move at the class level here — the
    // per-account split is meaningless to classTargetVsActual which buckets by
    // class). extraByClass also bumps the household total, so post-buy actual
    // %s are measured against the post-buy portfolio.
    const extraByClass = new Map<AssetClass, number>();
    for (const r of result.rows) {
      extraByClass.set(r.assetClass, (extraByClass.get(r.assetClass) ?? 0) + r.buyDollars);
    }
    return trackingError(classTargetVsActual(valuations, classTargets, extraByClass));
  }, [valuations, classTargets, result]);

  const hasTargets = (classTargets?.length ?? 0) > 0;

  return (
    <CalculatorCard
      cardId={cardId}
      title="Contribution allocator"
      titleText="Contribution allocator"
      dirty={isOverridden}
      headline={hasTargets && contribution != null ? formatCurrency(result.totalAllocated) : '—'}
      meaning={
        !hasTargets ? (
          // UX H1: a REAL link to where targets are authored — not dead prose.
          <EmptyMeaning>
            <InlineLink to="/investments">
              Set asset-class targets on the Investments page
            </InlineLink>{' '}
            to allocate a contribution toward them.
          </EmptyMeaning>
        ) : contribution == null ? (
          // D4: no history and no entry — an honest prompt, never a demo $1,000.
          <EmptyMeaning>Enter a monthly contribution to see the buy plan.</EmptyMeaning>
        ) : (
          <>of a {formatCurrency(contribution)} contribution, allocated toward your targets</>
        )
      }
      rail={
        hasTargets ? (
          <>
            {isOverridden && <RailReset onClick={reset} />}
            {/* D4: the derived prefill (rolling 12 months ÷ 12); a $/mo field
                so it feeds the shared next-dollar semantics. */}
            <NumberField
              id="alloc-contribution"
              label="Monthly contribution"
              value={contribution}
              onChange={(v) => setValue('contribution', v)}
              suffix="$/mo"
              step="100"
              min={0}
              edited={overriddenKeys.has('contribution')}
            />
          </>
        ) : undefined
      }
    >
      {/* D4: contribution == null keeps the results section out entirely —
          the meaning slot carries the "enter a monthly contribution" prompt. */}
      {hasTargets && contribution != null && (
        <div className="space-y-3">
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

          {result.unallocatableClasses.length > 0 && (
            // Wave-9: a targeted class with NO held ticker has no buy vehicle,
            // so its budget silently stayed in cash — name it and the leftover.
            <div
              role="note"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
            >
              You target {result.unallocatableClasses.map((u) => ASSET_CLASS_LABEL[u.assetClass]).join(', ')} but hold
              nothing in {result.unallocatableClasses.length === 1 ? 'that class' : 'those classes'} —{' '}
              {formatCurrency(result.unallocatableClasses.reduce((s, u) => s + u.need, 0))} stays in cash.
              Add a holding in the class (Investments → Manage → Holdings) or adjust your targets.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <StatTile testId="allocator-total" label="Total allocated" value={formatCurrency(result.totalAllocated)} />
            <StatTile testId="allocator-cash-left" label="Cash left over" value={formatCurrency(result.cashLeftOver)} />
          </div>

          {/* Compact before/after tracking error — one-sided (½·Σ|drift|), NOT two donuts. */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              testId="allocator-drift-before"
              label="Off-target now"
              value={`${(driftBefore * 100).toFixed(1)}%`}
            />
            <StatTile
              testId="allocator-drift-after"
              label="After this contribution"
              value={`${(driftAfter * 100).toFixed(1)}%`}
            />
          </div>
          {/* Wave 18 C12: plain-language caption under the drift pair. */}
          <p className="text-xs text-muted-foreground">
            Share of your portfolio that would need to move to hit targets.
          </p>

          {/* DOLLARS ONLY (H1): Buy $ is the allocation — no Shares column.
              Wave 18 C12: class-grouped rows with per-class subtotals; the
              Class column died (redundant with the group headers). */}
          <div data-testid="allocator-results">
            <CalcTable columns={BUY_COLUMNS}>
              {(() => {
                // Group rows by assetClass (stable insertion order).
                const groups = new Map<AssetClass, typeof result.rows>();
                for (const r of result.rows) {
                  const list = groups.get(r.assetClass) ?? [];
                  list.push(r);
                  groups.set(r.assetClass, list);
                }
                return [...groups.entries()].flatMap(([cls, rows]) => [
                  <tr key={`header-${cls}`}>
                    <td
                      colSpan={4}
                      className="pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {ASSET_CLASS_LABEL[cls]}
                    </td>
                  </tr>,
                  ...rows.map((r) => (
                    <CalcRow
                      key={r.ticker}
                      columns={BUY_COLUMNS}
                      cells={[
                        <span className="font-mono">{r.ticker}</span>,
                        formatCurrency(r.buyDollars),
                        `${(r.newPct * 100).toFixed(1)}%`,
                        r.targetPct != null ? `${(r.targetPct * 100).toFixed(1)}%` : '—',
                      ]}
                    />
                  )),
                  <CalcRow
                    key={`subtotal-${cls}`}
                    columns={BUY_COLUMNS}
                    subtotal
                    cells={[
                      'Subtotal',
                      formatCurrency(rows.reduce((a, r) => a + r.buyDollars, 0)),
                      '',
                      '',
                    ]}
                  />,
                ]);
              })()}
            </CalcTable>
          </div>

          {/* Finance L2: be explicit that this covers held positions only. */}
          <p className="text-xs text-muted-foreground">
            Approximate, using the latest snapshot per account, over held positions only
            (snapshot value is distributed by share count — no live prices, and accounts
            with no holdings, e.g. cash, aren’t included).
          </p>
        </div>
      )}
      {hasTargets && (
        <div className="pt-1">
          <InlineLink to="/investments" className="text-sm">
            Adjust targets →
          </InlineLink>
        </div>
      )}
    </CalculatorCard>
  );
}
