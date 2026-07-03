import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import { applyCardLayout, type InvestmentsCardEntry } from '@/lib/investments-card-layout';
import { getDatabase } from '@/db/db';
import { AccountType, AssetClass } from '@/types/enums';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { includedAccountIds } from '@/lib/account-inclusion';
import { useViewFilter } from '@/lib/use-view-filter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CardEditFrame from '@/components/investments/CardEditFrame';
import { DataHealthPopover } from '@/components/investments/DataHealthPopover';
import { AssetClassTargetsForm } from '@/components/investments/AssetClassTargetsForm';
import type { CardLayoutEntry, AssetClassTarget } from '@/types/schema';
import ContributionsByBucketChart from '@/components/charts/ContributionsByBucketChart';
import DonutChartCard from '@/components/charts/DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from '@/components/charts/DonutEntityPicker';
import { paletteColorAt } from '@/components/charts/palette';
import AssetValueChart from '@/components/charts/AssetValueChart';
import PerTickerDonut from '@/components/charts/PerTickerDonut';
import SectorDonut from '@/components/charts/SectorDonut';
import GrowthCard from '@/components/charts/GrowthCard';
import AccountBreakdownCard from '@/components/charts/AccountBreakdownCard';
import {
  computeHorizonGrowth,
  sumLatestOnOrBefore,
} from '@/lib/growth-horizons';
import { computeAccountBreakdown } from '@/lib/account-breakdown';
import { colorForAccount } from '@/lib/chart-colors';
import { useConcentration } from '@/lib/use-concentration';
import { valueHoldings, type HoldingValuation } from '@/lib/holdings-value';
import { classTargetVsActual, holdingTargetVsActual } from '@/lib/allocation-hierarchy';
import type { Dependent, AccountSnapshot, Household, Holding } from '@/types/schema';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import type { CsvColumn } from '@/lib/csv';
import { topEffectiveExposures, type ConcentrationWarning } from '@/lib/concentration';
import { AlertTriangleIcon, PieChart } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { YahooClient } from '@/market/yahoo-client';
import { TickersRepo } from '@/domain/tickers';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { HoldingsRepo } from '@/domain/holdings';
import { syncStaleFunds } from '@/market/fund-holdings-sync';

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

/**
 * Account types that count toward "investments value" on the growth card —
 * everything except plain cash/savings. This is DELIBERATELY not the shared
 * retirement-FI definition (src/lib/fi-portfolio.ts): this card measures
 * "how are my invested dollars doing", so 529s belong (they're invested)
 * and cash doesn't (it isn't). The FI/Coast/Compound defaults use the
 * shared selector instead.
 */
const INVESTMENT_ACCOUNT_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_401K,
  AccountType.ACCOUNT_ROTH_401K,
  AccountType.ACCOUNT_ROTH_IRA,
  AccountType.ACCOUNT_TRAD_IRA,
  AccountType.ACCOUNT_BROKERAGE,
  AccountType.ACCOUNT_HSA,
  AccountType.ACCOUNT_CRYPTO,
  AccountType.ACCOUNT_529,
]);

/**
 * Educational copy for each warning type, surfaced as a tooltip on the
 * Concentration Health section. Phase 3 keeps tooltips simple — a `title`
 * attribute renders a native browser tooltip; no popover library required.
 */
const CONCENTRATION_TOOLTIP: Record<ConcentrationWarning['type'], string> = {
  PER_TICKER_HIGH: "A single ticker's outsized share concentrates idiosyncratic risk.",
  PER_TICKER_SOFT: "Watch this ticker — it's getting concentrated.",
  PER_ASSET_CLASS_HIGH: 'Heavy weight in one asset class amplifies its drawdowns.',
  PER_ASSET_CLASS_SOFT: 'Asset-class exposure is approaching concentrated territory.',
  LEVERAGE_HIGH: 'Effective leverage means small moves cause big P&L swings.',
};

function severityColor(severity: ConcentrationWarning['severity']): string {
  switch (severity) {
    case 'HIGH': return 'text-destructive-soft-foreground';
    case 'MEDIUM': return 'text-warning-foreground';
    case 'LOW':
    default: return 'text-info-foreground';
  }
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
): { name: string; value: number; color: string }[] {
  const buckets = new Map<AssetClass, number>();
  for (const v of valuations) {
    buckets.set(v.assetClass, (buckets.get(v.assetClass) ?? 0) + v.value);
  }
  // Sort desc by value FIRST, then attach a color by sorted index so the
  // largest class gets the most-separated hue (idx 0). The color is the single
  // source for BOTH the donut slice and the picker item, so the wedge, legend,
  // and picker swatch can't diverge when a class is hidden and the list
  // reindexes (the I9 desync fix). Assigning over WEDGE_PALETTE also keeps any
  // class off the near-white band.
  return [...buckets.entries()]
    .map(([cls, value]) => ({ name: ASSET_CLASS_LABEL[cls], value }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((b, idx) => ({ ...b, color: paletteColorAt(idx) }));
}

/**
 * Project a 529 plan's value forward to the beneficiary's 18th birthday.
 * Uses monthly compounding at `growthRate` annual, plus the beneficiary's
 * recent monthly contribution rate. Returns `currentValue` if the
 * beneficiary is already 18 or older (monthsUntil clamps to 0).
 */
function projectedAtAge18(
  currentValue: number,
  monthlyContrib: number,
  dobIso: string,
  growthRate: number,
): number {
  const dob = new Date(dobIso);
  const eighteen = new Date(dob);
  eighteen.setFullYear(eighteen.getFullYear() + 18);
  const now = new Date();
  const monthsUntil = Math.max(
    0,
    (eighteen.getFullYear() - now.getFullYear()) * 12 +
      (eighteen.getMonth() - now.getMonth()),
  );
  const r = growthRate / 12;
  if (r === 0) return currentValue + monthlyContrib * monthsUntil;
  return (
    currentValue * Math.pow(1 + r, monthsUntil) +
    (monthlyContrib * (Math.pow(1 + r, monthsUntil) - 1)) / r
  );
}

/**
 * Pick the growth rate to project against. Prefers the entry labelled
 * "Moderate", then the second entry, then the first, then 6%. Defensive
 * defaults matter because the page renders before household.load() resolves.
 * Mirrors the helper in Goals.tsx so projections feel consistent.
 */
function pickModerateRate(household: Household | null): number {
  const FALLBACK = 0.06;
  if (!household || household.growthScenarios.length === 0) return FALLBACK;
  const moderate = household.growthScenarios.find((s) => s.label === 'Moderate');
  if (moderate) return moderate.rate;
  const second = household.growthScenarios[1];
  if (second) return second.rate;
  return household.growthScenarios[0]?.rate ?? FALLBACK;
}

function renderCardFlow(cards: InvestmentsCardEntry[]): ReactNode[] {
  // Group consecutive `compact` cards into the existing 3-up donut grid; render
  // `wide` cards full-width. Preserves today's layout when the three donuts
  // are visible and adjacent — a wide card between them simply splits the grid.
  // Every card wrapper carries id={card.id} as an anchor target for deep
  // links (#concentration) and the warning->donut scroll buttons.
  const out: ReactNode[] = [];
  let compactRun: InvestmentsCardEntry[] = [];
  const flushCompact = () => {
    if (compactRun.length === 0) return;
    out.push(
      <div key={`grid-${compactRun[0].id}`} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {compactRun.map((c) => <div key={c.id} id={c.id}>{c.render()}</div>)}
      </div>,
    );
    compactRun = [];
  };
  for (const card of cards) {
    if (card.size === 'compact') { compactRun.push(card); continue; }
    flushCompact();
    out.push(<div key={card.id} id={card.id}>{card.render()}</div>);
  }
  flushCompact();
  return out;
}

export default function Investments() {
  const { filter, persons } = useViewFilter();

  const [editMode, setEditMode] = useState(false);

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const holdingsError = useHoldingsStore((s) => s.error);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const contributionsError = useContributionsStore((s) => s.error);
  const dependents = useDependentsStore((s) => s.dependents);
  const loadDependents = useDependentsStore((s) => s.load);
  const dependentsError = useDependentsStore((s) => s.error);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const householdError = useHouseholdStore((s) => s.error);
  // Settings drives the Investments card-layout overlay (id order + hidden
  // flags). null === default flow; see applyCardLayout() for semantics.
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsError = useSettingsStore((s) => s.error);
  const updateSettings = useSettingsStore((s) => s.update);
  // Tickers + fund holdings power the Concentration Health section below.
  // Loaded here so useConcentration() sees populated stores on first paint.
  const tickers = useTickersStore((s) => s.tickers);
  const loadTickers = useTickersStore((s) => s.load);
  const loadFundHoldings = useFundHoldingsStore((s) => s.load);
  const loadFundSectors = useFundSectorsStore((s) => s.load);

  const reload = useCallback(() => {
    loadAccounts();
    loadHoldings();
    loadSnapshots();
    loadContributions();
    loadDependents();
    loadHousehold();
    loadSettings();
    loadTickers();
    loadFundHoldings();
    loadFundSectors();
  }, [
    loadAccounts,
    loadHoldings,
    loadSnapshots,
    loadContributions,
    loadDependents,
    loadHousehold,
    loadSettings,
    loadTickers,
    loadFundHoldings,
    loadFundSectors,
  ]);
  useEffect(() => {
    reload();
  }, [reload]);

  // Errors from the core investment data stores (page-level only — does NOT
  // touch the concentration/donut data flow). Surfaced as a banner so a load
  // failure reads as recoverable, and the empty-state copy below is suppressed
  // when set.
  const storeErrors = [
    accountsError,
    holdingsError,
    snapshotsError,
    contributionsError,
    dependentsError,
    householdError,
    settingsError,
  ];
  const hasStoreError = storeErrors.some((e) => e != null);

  // Filter accounts by the household / p1 / p2 / joint dropdown. Holdings,
  // snapshots, and contributions all scope to "visible accounts" — they
  // have no person field of their own, only an accountId, so ownership
  // flows down from the account.
  const visibleAccounts = useMemo(
    () => filterByOwnerPersonId(accounts, filter, persons),
    [accounts, filter, persons],
  );
  const visibleAccountIds = useMemo(
    () => new Set(visibleAccounts.map((a) => a.id).filter((id): id is number => id != null)),
    [visibleAccounts],
  );
  const visibleHoldings = useMemo(
    () => (filter === 'household' ? holdings : holdings.filter((h) => visibleAccountIds.has(h.accountId))),
    [holdings, filter, visibleAccountIds],
  );

  // Unclassified-tickers banner inputs. A ticker counts as unclassified when
  // it has no row in the `tickers` store, or its row exists but the human
  // name was never set (name === null) — both states mean auto-classification
  // didn't land and the donut groupings can't trust the asset_class column.
  // Building a Map once keeps the per-holding lookup O(1) across re-renders.
  const tickerByName = useMemo(
    () => new Map(tickers.map((t) => [t.ticker, t])),
    [tickers],
  );
  const unclassifiedTickers = useMemo(() => {
    const set = new Set<string>();
    for (const h of visibleHoldings) {
      const row = tickerByName.get(h.ticker);
      if (!row || row.name === null) set.add(h.ticker);
    }
    return [...set].sort();
  }, [visibleHoldings, tickerByName]);

  // CSV export. accountId resolves to the account name via accountById; a
  // null id, or one with no matching account, becomes ''. targetAllocationPct
  // is the stored 0..1 fraction and is exported raw (no ×100) — hence the
  // header 'target allocation' rather than 'target allocation %'. The rows
  // are the full `holdings` array; the ?view filter is intentionally ignored.
  const accountById = useMemo(
    () => new Map(accounts.filter((a) => a.id != null).map((a) => [a.id as number, a.name])),
    [accounts],
  );
  const csvColumns = useMemo<CsvColumn<Holding>[]>(
    () => [
      {
        header: 'account',
        value: (h) => accountById.get(h.accountId) ?? '',
      },
      { header: 'ticker', value: (h) => h.ticker },
      { header: 'share count', value: (h) => h.shareCount },
      { header: 'cost basis', value: (h) => h.costBasis },
      { header: 'target allocation', value: (h) => h.targetAllocationPct },
    ],
    [accountById],
  );

  const visibleSnapshots = useMemo(
    () => (filter === 'household' ? snapshots : snapshots.filter((s) => visibleAccountIds.has(s.accountId))),
    [snapshots, filter, visibleAccountIds],
  );
  const visibleContributions = useMemo(
    () => (filter === 'household' ? contributions : contributions.filter((c) => visibleAccountIds.has(c.accountId))),
    [contributions, filter, visibleAccountIds],
  );

  // Investment-only account ids for the growth card — drop cash/savings so the
  // card measures "investments value", not total liquid assets, and drop
  // excluded-from-net-worth accounts (shared selector) so this card agrees
  // with the Portfolio-by-account card, which already excludes them. Derived
  // from visibleAccounts so the view filter flows through.
  const investmentAccountIds = useMemo(() => {
    const included = includedAccountIds(visibleAccounts);
    return new Set(
      visibleAccounts
        .filter((a) => INVESTMENT_ACCOUNT_TYPES.has(a.type))
        .map((a) => a.id)
        .filter((id): id is number => id != null && included.has(id)),
    );
  }, [visibleAccounts]);

  // Growth across the five horizons (1d…1y). sumLatestOnOrBefore reads the
  // full snapshots array and scopes to investment accounts via the id set;
  // forward-only history means most horizons resolve to null today and the
  // card shows "Not enough history yet" for them — that's expected.
  const investmentsGrowth = useMemo(
    () =>
      computeHorizonGrowth(
        (iso) => sumLatestOnOrBefore(snapshots, iso, investmentAccountIds),
        new Date(),
      ),
    [snapshots, investmentAccountIds],
  );

  // Concentration health is intentionally household-wide regardless of the
  // person filter — concentration semantics ("is one ticker too big a share
  // of *the portfolio*?") don't change when you focus on one owner. Keeping
  // the card hook unconditional keeps the section stable across filter flips.
  const concentration = useConcentration();

  const [assetClassByTicker, setAssetClassByTicker] = useState<Map<string, AssetClass>>(
    () => new Map(),
  );

  // "Investable only" toggle for the Portfolio-by-account card. When ON it
  // drops cash-like accounts (CASH/SAVINGS) from the rows, the composition
  // bar, AND the % denominator. Default OFF so % sums to 100% across
  // everything held. Persisted in localStorage (a single boolean — simpler
  // than the donut pickers' hidden-set shape) so the choice survives reloads;
  // the lazy initializer reads it once and guards against unavailable storage.
  const INVESTABLE_ONLY_KEY = 'investments.byAccount.investableOnly';
  const [investableOnly, setInvestableOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INVESTABLE_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const handleToggleInvestableOnly = (next: boolean) => {
    setInvestableOnly(next);
    try {
      if (next) localStorage.setItem(INVESTABLE_ONLY_KEY, '1');
      else localStorage.removeItem(INVESTABLE_ONLY_KEY);
    } catch {
      // Private-mode / disabled storage: keep the in-memory toggle working.
    }
  };

  // One-shot sector backfill on first mount when the user holds funds but
  // the fund_sectors table is empty. Covers existing users whose
  // last_refresh_at is recent (so the launch refresh in init.ts is gated off)
  // but whose fund_sectors never got populated because migration 0021 landed
  // *after* their last sync. Runs in the background — Yahoo unreachable is
  // logged and swallowed, identical posture to runMarketDataRefresh.
  const fundSectors = useFundSectorsStore((s) => s.fundSectors);
  const fundHoldings = useFundHoldingsStore((s) => s.fundHoldings);
  const [didAutoBackfill, setDidAutoBackfill] = useState(false);

  useEffect(() => {
    if (didAutoBackfill) return;
    // Wait until both stores have loaded at least once. We can't tell "loaded
    // and empty" from "still loading" without a load flag, so we use
    // fundHoldings as a proxy: if the user holds funds the launch refresh
    // populated fundHoldings, and an empty fund_sectors next to a non-empty
    // fund_holdings is exactly the regression we're patching here.
    if (fundHoldings.length === 0) return;
    if (fundSectors.length > 0) return;
    setDidAutoBackfill(true);
    void (async () => {
      try {
        const db = getDatabase();
        await syncStaleFunds({
          yahoo: new YahooClient(),
          fundHoldings: new FundHoldingsRepo(db),
          fundSectors: new FundSectorsRepo(db),
          tickers: new TickersRepo(db),
          holdings: new HoldingsRepo(db),
        });
        await loadFundSectors();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[investments] auto sector backfill failed:', err);
      }
    })();
  }, [fundHoldings, fundSectors, didAutoBackfill, loadFundSectors]);

  // Look up asset classes whenever the set of tickers changes. The tickers
  // table starts empty in Phase 2; this lookup gracefully resolves to an
  // empty map and every holding falls back to AssetClass.OTHER.
  useEffect(() => {
    const tickers = Array.from(new Set(visibleHoldings.map((h) => h.ticker))).sort();
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
  }, [visibleHoldings]);

  const latestPerAccount = useMemo(
    () => latestSnapshotPerAccount(visibleSnapshots),
    [visibleSnapshots],
  );

  const valuations = useMemo(
    () => valueHoldings(visibleAccounts, visibleHoldings, latestPerAccount, assetClassByTicker),
    [visibleAccounts, visibleHoldings, latestPerAccount, assetClassByTicker],
  );

  const allocation = useMemo(
    () => aggregateByAssetClass(valuations),
    [valuations],
  );

  // Distinct asset classes the user actually holds — drives the
  // AssetClassTargetsForm (only show classes with at least one held position)
  // and gates the 'class-targets' card's `applicable`.
  const heldClasses = useMemo(() => {
    const set = new Set<AssetClass>();
    for (const v of valuations) set.add(v.assetClass);
    return [...set];
  }, [valuations]);

  // Asset-allocation donut entity picker. Keys are the asset-class display
  // labels (already unique by definition); persisted under
  // `donut.assetAllocation.hidden`. The picker renders in the card header
  // via DonutChartCard's headerRight slot (Wave 3) — the old
  // absolute-positioned overlay workaround is retired.
  const allocationPickerItems = useMemo<DonutEntityPickerItem[]>(
    () =>
      allocation.map((s) => ({
        key: s.name,
        label: s.name,
        // Same resolved color the slice carries (aggregateByAssetClass) so the
        // picker swatch == wedge == legend swatch through any hide/reindex.
        color: s.color,
      })),
    [allocation],
  );
  const allocationKeys = useMemo(
    () => allocationPickerItems.map((i) => i.key),
    [allocationPickerItems],
  );
  const allocationSelected = useDonutSelected(
    'donut.assetAllocation.hidden',
    allocationKeys,
  );
  const filteredAllocation = useMemo(
    () => allocation.filter((s) => allocationSelected.has(s.name)),
    [allocation, allocationSelected],
  );
  // Full-universe denominator (hidden classes included) so hiding a class
  // never re-normalizes the shares that remain.
  const allocationTotal = useMemo(
    () => allocation.reduce((s, x) => s + x.value, 0),
    [allocation],
  );

  // Two sibling target-vs-actual views (I10): class drift is household-level,
  // holding drift is within-class aggregated per ticker across accounts. Both
  // consume the same household class targets from settings.
  const classRows = useMemo(
    () => classTargetVsActual(valuations, settings?.assetClassTargetAllocations ?? null),
    [valuations, settings?.assetClassTargetAllocations],
  );
  const holdingRows = useMemo(
    () => holdingTargetVsActual(valuations, settings?.assetClassTargetAllocations ?? null),
    [valuations, settings?.assetClassTargetAllocations],
  );

  const currentMonth = new Date().toISOString().slice(0, 7);

  // 12-month window for the stacked-by-bucket contributions chart, the sole
  // contributions chart on the page. The stack height reads as the monthly
  // total, so a separate single-series totals chart isn't needed.
  const contribRange = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    const from = new Date(Date.UTC(y - 1, m - 1, 1));
    return { from: from.toISOString().slice(0, 7), to: currentMonth };
  }, [currentMonth]);

  // 529 section derivations. We keep these out of the JSX body so the
  // section can short-circuit when there are no 529 accounts without
  // wasting work on the typical case (most households have none). 529s
  // belonging to filtered-out persons disappear automatically because
  // visibleAccounts already honours the view filter.
  const plans529 = useMemo(
    () => visibleAccounts.filter((a) => a.type === AccountType.ACCOUNT_529),
    [visibleAccounts],
  );

  const dependentById = useMemo<Map<number, Dependent>>(
    () => new Map(dependents.filter((d) => d.id != null).map((d) => [d.id!, d])),
    [dependents],
  );

  // Latest snapshot per account by snapshotDate. We need the full snapshot
  // (not just totalValue, like latestPerAccount above) so the 529 card can
  // surface the snapshot date if we ever want to. Today only the value is
  // displayed but keeping the row makes future tweaks cheap.
  const latestSnapByAccount = useMemo(() => {
    const map = new Map<number, AccountSnapshot>();
    for (const s of visibleSnapshots) {
      const prev = map.get(s.accountId);
      if (!prev || s.snapshotDate > prev.snapshotDate) map.set(s.accountId, s);
    }
    return map;
  }, [visibleSnapshots]);

  const today529 = useMemo(() => new Date(), []);
  const moderateRate = useMemo(() => pickModerateRate(household), [household]);

  // Top-level card registry. Each `render` returns the same JSX the page used
  // to render inline — the registry is a 1:1 move so default behavior (layout
  // null) is byte-identical to the prior inline order. The 529 card uses its
  // existing has-529 guard as `applicable`; the rest render unconditionally
  // today (drift / contributions / by-account always render with their own
  // empty-state messages when there's nothing to show), so they're always
  // applicable. Layout overlay is applied via applyCardLayout below.
  // Portfolio-by-account breakdown — % of portfolio, current value, change
  // vs last month per account. Built off the *visible* account + snapshot
  // sets the rest of the page uses, so the view filter (household /
  // p1 / p2 / joint) flows through; the helper applies the
  // excludedFromNetWorth and investable-only rules itself. `new Date()` is the
  // injected "now" — the helper is otherwise pure/deterministic.
  const accountBreakdown = useMemo(
    () =>
      computeAccountBreakdown(visibleAccounts, visibleSnapshots, new Date(), {
        investableOnly,
      }),
    [visibleAccounts, visibleSnapshots, investableOnly],
  );

  // Per-account swatch/segment colors for the breakdown card. Resolved here
  // (not in the presentational card) so each account's accent_color override
  // wins, falling back to the deterministic palette-by-id default.
  const breakdownColors = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of visibleAccounts) {
      if (a.id != null) map.set(a.id, colorForAccount(a.id, a.accentColor));
    }
    return map;
  }, [visibleAccounts]);

  // Latest snapshot date across the *visible* accounts — the "as of" line on
  // the breakdown card. Snapshot dates are ISO YYYY-MM-DD so a lexical max is
  // chronological. Null when there are no snapshots yet.
  const breakdownAsOf = useMemo(() => {
    let max: string | null = null;
    for (const s of visibleSnapshots) {
      if (max === null || s.snapshotDate > max) max = s.snapshotDate;
    }
    return max;
  }, [visibleSnapshots]);

  // Default order only — customized users keep their saved order
  // (applyCardLayout orders by saved index and appends unknown ids). The
  // donut trio (allocation, per-company, sector) stays adjacent as one 3-up
  // compact row with Concentration Health directly beneath its inputs;
  // class-targets sits next to drift, which consumes the targets.
  const cardRegistry: InvestmentsCardEntry[] = useMemo(
    () => [
      {
        id: 'time-series',
        label: 'Investments Over Time',
        size: 'wide',
        applicable: true,
        // AssetValueChart 'investments' surface reads stores + the ?view
        // filter itself (respectViewFilter) — no props to thread. Card id
        // and label are UNCHANGED so saved investments_card_layout rows
        // keep applying (applyCardLayout matches by id).
        render: () => <AssetValueChart surface="investments" />,
      },
      {
        id: 'growth',
        label: 'Investments growth',
        size: 'wide',
        applicable: true,
        render: () => (
          /*
           * Investments growth card. Click (or use the chevrons / arrow keys)
           * to cycle the horizon from "since yesterday" through "past year".
           * Sits above the donut grid so the headline number reads first.
           */
          <GrowthCard title="Investments growth" horizons={investmentsGrowth} />
        ),
      },
      {
        id: 'allocation',
        label: 'Asset allocation',
        size: 'compact',
        applicable: true,
        render: () =>
          allocation.length > 0 ? (
            <div data-testid="asset-allocation-card">
              {filteredAllocation.length > 0 ? (
                <DonutChartCard
                  title="Asset allocation"
                  subtitle="Approximate, using latest snapshot per account"
                  data={filteredAllocation}
                  shareTotal={allocationTotal}
                  valueFormatter={formatCurrency}
                  headerRight={
                    <DonutEntityPicker
                      localStorageKey="donut.assetAllocation.hidden"
                      items={allocationPickerItems}
                    />
                  }
                />
              ) : (
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle>Asset allocation</CardTitle>
                        <CardDescription>
                          Approximate, using latest snapshot per account
                        </CardDescription>
                      </div>
                      {/* Picker must stay reachable in the all-hidden state
                          or the user can never re-show a class. */}
                      <DonutEntityPicker
                        localStorageKey="donut.assetAllocation.hidden"
                        items={allocationPickerItems}
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      All entities hidden. Open the picker above to show at least one.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card data-testid="asset-allocation-card">
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
          ),
      },
      {
        id: 'per-company',
        label: 'Per-company exposure',
        size: 'compact',
        applicable: true,
        render: () => <PerTickerDonut />,
      },
      {
        id: 'sector',
        label: 'Sector exposure',
        size: 'compact',
        applicable: true,
        render: () => <SectorDonut />,
      },
      {
        id: 'concentration',
        label: 'Concentration Health',
        size: 'wide',
        applicable: true,
        render: () => (
          <Card data-testid="concentration-section">
            <CardHeader>
              <CardTitle>
                <TermTooltip term="CONCENTRATION">Concentration</TermTooltip> Health
              </CardTitle>
              <CardDescription>
                Effective exposure after fund look-through and leverage. Warnings
                fire when a single ticker exceeds 25%, an asset class exceeds 60%,
                or total leverage exceeds 1.5x.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {concentration.warnings.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No concentration issues detected.
                </div>
              ) : (
                <ul className="space-y-3">
                  {concentration.warnings.map((w, i) => (
                    <li
                      key={`${w.type}-${w.ticker ?? w.assetClass ?? i}`}
                      className="flex items-start gap-3"
                    >
                      <AlertTriangleIcon
                        className={`h-5 w-5 shrink-0 mt-0.5 ${severityColor(w.severity)}`}
                        aria-label={`${w.severity} severity`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{w.message}</div>
                        <details className="mt-1">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Why this matters
                          </summary>
                          <p className="text-xs text-muted-foreground mt-1">
                            {CONCENTRATION_TOOLTIP[w.type]}
                          </p>
                        </details>
                        {/* Anchor-scroll to the donut that visualizes this
                            warning's subject (ticker → per-company card;
                            asset class → allocation card). A slice-focus
                            pulse is a noted follow-up (needs a focus channel
                            on useDonutSelection). */}
                        {(w.ticker || w.assetClass) && (
                          <button
                            type="button"
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                            onClick={() =>
                              document
                                .getElementById(w.ticker ? 'per-company' : 'allocation')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            }
                          >
                            View in donut
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {(() => {
                const top = topEffectiveExposures(concentration.perTicker, 3);
                if (top.length === 0) return null;
                return (
                  <div className="mt-6 border-t pt-4">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                      Top 3 effective exposures
                    </div>
                    <ul className="space-y-1 text-sm">
                      {top.map((t) => (
                        <li key={t.ticker} className="flex justify-between gap-2 tabular-nums">
                          <span className="font-mono">{t.ticker}</span>
                          <span className="text-muted-foreground">
                            {(t.pctOfPortfolio * 100).toFixed(1)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        ),
      },
      {
        id: 'class-targets',
        label: 'Asset-class targets',
        size: 'compact',
        applicable: heldClasses.length > 0,
        render: () => (
          <AssetClassTargetsForm
            heldClasses={heldClasses}
            initial={settings?.assetClassTargetAllocations ?? null}
            onSave={async (targets: AssetClassTarget[]) => {
              await updateSettings({ assetClassTargetAllocations: targets });
            }}
          />
        ),
      },
      {
        id: 'drift',
        label: 'Target vs Actual',
        size: 'wide',
        applicable: true,
        render: () => (
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
                            <td className={`py-2 pl-2 text-right tabular-nums ${r.targetPct == null ? 'text-muted-foreground' : r.driftPct >= 0 ? 'text-success-foreground' : 'text-destructive'}`}>
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
                              <td className={`py-2 pl-2 text-right tabular-nums ${r.targetValue == null ? 'text-muted-foreground' : r.driftPct >= 0 ? 'text-success-foreground' : 'text-destructive'}`}>
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
        ),
      },
      {
        id: 'contributions',
        label: 'Contributions by bucket',
        size: 'wide',
        applicable: true,
        render: () => (
          <ContributionsByBucketChart
            accounts={visibleAccounts}
            contributions={visibleContributions}
            fromYyyymm={contribRange.from}
            toYyyymm={contribRange.to}
          />
        ),
      },
      {
        id: 'by-account',
        label: 'Portfolio by account',
        size: 'wide',
        applicable: true,
        // Portfolio-by-account breakdown — replaces the old flat "Accounts"
        // list. Shows each account's share of the portfolio (100%-stacked bar
        // + per-row %), current value, and change vs last month, plus a
        // header total. The "View holdings" link from the old card is
        // preserved via viewHoldingsTo. All math comes from
        // computeAccountBreakdown above; this is presentation only.
        render: () => (
          <AccountBreakdownCard
            rows={accountBreakdown.rows}
            total={accountBreakdown.total}
            colorByAccountId={breakdownColors}
            investableOnly={investableOnly}
            onToggleInvestableOnly={handleToggleInvestableOnly}
            asOfDate={breakdownAsOf}
            viewHoldingsTo="/inputs/holdings"
          />
        ),
      },
      {
        id: 'plans-529',
        label: '529 Plans',
        size: 'wide',
        applicable: plans529.length > 0,
        render: () => (
          <Card data-testid="529-section">
            <CardHeader>
              <CardTitle>529 Plans</CardTitle>
              <CardDescription>
                College savings — current value, contributions YTD, and
                projected value at the beneficiary's 18th birthday using the
                Moderate growth scenario ({(moderateRate * 100).toFixed(1)}%).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {plans529.map((plan) => {
                  const dep =
                    plan.beneficiaryDependentId != null
                      ? dependentById.get(plan.beneficiaryDependentId)
                      : null;
                  const latestSnap =
                    plan.id != null ? latestSnapByAccount.get(plan.id) : undefined;
                  const currentValue = latestSnap?.totalValue ?? 0;
                  // YTD = sum of contributions in the current calendar year.
                  const yearPrefix = String(today529.getFullYear());
                  const ytdContribs = visibleContributions
                    .filter(
                      (c) =>
                        c.accountId === plan.id && c.date.startsWith(yearPrefix),
                    )
                    .reduce((sum, c) => sum + c.amount, 0);
                  // Approximate the projection's monthly inflow with YTD ÷ months
                  // elapsed this year. Coarse but matches what the user can see
                  // in the contribution log; refines automatically as the year
                  // progresses.
                  const monthsThisYear = today529.getMonth() + 1;
                  const monthlyAvg =
                    monthsThisYear > 0 ? ytdContribs / monthsThisYear : 0;
                  const projected =
                    dep != null
                      ? projectedAtAge18(
                          currentValue,
                          monthlyAvg,
                          dep.dateOfBirth,
                          moderateRate,
                        )
                      : currentValue;
                  return (
                    <li
                      key={plan.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{plan.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {dep ? `for ${dep.name}` : 'no beneficiary set'}
                          {plan.stateOfPlan ? ` · ${plan.stateOfPlan}` : ''}
                          {plan.institution ? ` · ${plan.institution}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0 text-sm space-y-0.5">
                        <div className="font-mono tabular-nums">
                          {formatCurrency(currentValue)}{' '}
                          <span className="text-muted-foreground">now</span>
                        </div>
                        <div className="font-mono tabular-nums">
                          {formatCurrency(ytdContribs)}{' '}
                          <span className="text-muted-foreground">YTD</span>
                        </div>
                        {dep != null && (
                          <div className="font-mono tabular-nums">
                            {formatCurrency(projected)}{' '}
                            <span className="text-muted-foreground">at 18</span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ),
      },
    ],
    [
      // contributions (time-series reads stores itself now)
      visibleAccounts,
      // growth
      investmentsGrowth,
      // allocation
      allocation,
      allocationPickerItems,
      filteredAllocation,
      allocationTotal,
      // class-targets
      heldClasses,
      settings?.assetClassTargetAllocations,
      updateSettings,
      // drift (two tables: class household-level + holding within-class)
      classRows,
      holdingRows,
      // concentration
      concentration,
      // contributions
      visibleContributions,
      contribRange.from,
      contribRange.to,
      // by-account (AccountBreakdownCard wiring)
      accountBreakdown,
      breakdownColors,
      breakdownAsOf,
      investableOnly,
      handleToggleInvestableOnly,
      // plans-529 (also drives `applicable`)
      plans529,
      dependentById,
      latestSnapByAccount,
      today529,
      moderateRate,
    ],
  );

  const cardLayout = settings?.investmentsCardLayout ?? null;
  const visibleCards = useMemo(
    () => applyCardLayout(cardRegistry, cardLayout),
    [cardRegistry, cardLayout],
  );

  // Deep links like /investments#concentration (ConcentrationCard's "See
  // full breakdown") scroll to the target card once cards have rendered.
  // A hidden card (customized layout) simply no-ops — the user's layout wins.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, visibleCards]);

  // Edit mode needs to render every applicable card (including hidden ones,
  // so the user can re-show them) in stored order. applyCardLayout drops
  // hidden cards, so we derive a parallel list here that keeps them in.
  const applicableCards = useMemo(
    () => cardRegistry.filter((c) => c.applicable),
    [cardRegistry],
  );

  const orderedForEdit = useMemo(() => {
    const layout = settings?.investmentsCardLayout ?? null;
    if (!layout) return applicableCards;
    const idx = new Map(layout.map((e, i) => [e.id, i]));
    const known = applicableCards.filter((c) => idx.has(c.id));
    const unknown = applicableCards.filter((c) => !idx.has(c.id));
    known.sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
    return [...known, ...unknown];
  }, [applicableCards, settings?.investmentsCardLayout]);

  const hiddenSet = useMemo(
    () =>
      new Set(
        (settings?.investmentsCardLayout ?? [])
          .filter((e) => e.hidden)
          .map((e) => e.id),
      ),
    [settings?.investmentsCardLayout],
  );

  // Single source of layout-mutation truth — mirrors SidebarSection.writeLayout.
  // Build a fresh overlay from the current applicable order + hidden set, then
  // hand a `mutate` callback a chance to flip `hidden` or swap entries.
  const writeCardLayout = (mutate: (entries: CardLayoutEntry[]) => CardLayoutEntry[]) => {
    const flat: CardLayoutEntry[] = orderedForEdit.map((c) => ({
      id: c.id,
      hidden: hiddenSet.has(c.id),
    }));
    void updateSettings({ investmentsCardLayout: mutate(flat) });
  };

  const toggleCardHidden = (id: string) =>
    writeCardLayout((entries) =>
      entries.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)),
    );

  const moveCard = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= orderedForEdit.length) return;
    writeCardLayout((entries) => {
      const next = [...entries];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const hasAnyHolding = visibleHoldings.length > 0;
  const hasAnySnapshot = visibleSnapshots.length > 0;

  // A user with a 529-only setup (no holdings, no snapshots elsewhere) still
  // wants to see their 529 card, so the empty state only fires when there
  // are also no 529 plans to surface.
  if (!hasAnyHolding && !hasAnySnapshot && plans529.length === 0) {
    return (
      <PageContainer className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Investments</h1>
          <p className="text-sm text-muted-foreground">
            Asset allocation, <TermTooltip term="DRIFT">drift</TermTooltip> from your targets, and contribution trends.
          </p>
        </div>
        {/*
         * Distinguish "empty because new" from "empty because the load failed":
         * a consumed-store error shows the recoverable banner; otherwise the
         * normalized EmptyState. The CTA routes to /inputs/accounts — Investments
         * combines account-level holdings and snapshots, and accounts is the
         * parent of both. (529 plans also live under /inputs/accounts.)
         */}
        {hasStoreError ? (
          <StoreErrorBanner errors={storeErrors} onRetry={reload} />
        ) : (
          <EmptyState
            icon={PieChart}
            title="No investment holdings yet"
            description="Set up accounts and holdings in Inputs to see your asset allocation and drift."
          >
            <Button asChild>
              <Link to="/inputs/accounts">Add an account</Link>
            </Button>
          </EmptyState>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={storeErrors} onRetry={reload} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-semibold">Investments</h1>
            <FreshnessBadge size="sm" />
            {/* Fund-data debug plumbing lives in this popover (1:1 move
                from the old inline header buttons). */}
            <DataHealthPopover />
          </div>
          <p className="text-sm text-muted-foreground">
            Allocation across asset classes,{' '}
            <TermTooltip term="DRIFT">drift</TermTooltip> from your targets, and contribution trends.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {editMode ? 'Done' : 'Customize'}
          </button>
          <ExportCsvButton baseName="holdings" columns={csvColumns} rows={holdings} />
        </div>
      </div>

      {/*
       * Unclassified-tickers banner. Surfaces when at least one held ticker
       * is missing from the tickers store (or has name === null) so the user
       * knows the donuts may bucket those positions as OTHER. Uses the same
       * warning-soft palette as DisclosureBanner — the closest existing
       * pattern in the codebase. We deliberately list every ticker rather
       * than truncating: the typical missing-ticker case is one or two
       * single stocks, and silently hiding the rest would obscure the fix.
       * Pre-customization this banner sat between the growth card and the
       * donut grid; it now sits above the customizable card flow so card
       * reordering never strands it next to an unrelated card.
       */}
      {unclassifiedTickers.length > 0 && (
        <div
          className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
          role="note"
          data-testid="unclassified-tickers-banner"
        >
          {unclassifiedTickers.length} holding{unclassifiedTickers.length === 1 ? '' : 's'} couldn't be auto-classified:{' '}
          <span className="font-mono">{unclassifiedTickers.join(', ')}</span>. Set their asset class manually in{' '}
          <Link to="/inputs/tickers" className="underline hover:no-underline">
            Inputs → Tickers
          </Link>
          .
        </div>
      )}

      {editMode ? (
        <div className="space-y-4">
          {orderedForEdit.map((card, i) => (
            <CardEditFrame
              key={card.id}
              label={card.label}
              hidden={hiddenSet.has(card.id)}
              canMoveUp={i > 0}
              canMoveDown={i < orderedForEdit.length - 1}
              onToggleHidden={() => toggleCardHidden(card.id)}
              onMoveUp={() => moveCard(i, -1)}
              onMoveDown={() => moveCard(i, 1)}
            >
              {card.render()}
            </CardEditFrame>
          ))}
        </div>
      ) : visibleCards.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            All cards hidden — click Customize to bring some back.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">{renderCardFlow(visibleCards)}</div>
      )}
    </PageContainer>
  );
}
