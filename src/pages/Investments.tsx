import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import { useViewFilter } from '@/lib/use-view-filter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CardEditFrame from '@/components/investments/CardEditFrame';
import { AssetClassTargetsForm } from '@/components/investments/AssetClassTargetsForm';
import type { CardLayoutEntry, AssetClassTarget } from '@/types/schema';
import ContributionsByBucketChart from '@/components/charts/ContributionsByBucketChart';
import DonutChartCard from '@/components/charts/DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from '@/components/charts/DonutEntityPicker';
import { paletteColorAt } from '@/components/charts/palette';
import InvestmentTimeSeriesChart from '@/components/charts/InvestmentTimeSeriesChart';
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
import type { Dependent, AccountSnapshot, Household, Holding } from '@/types/schema';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import type { CsvColumn } from '@/lib/csv';
import { topEffectiveExposures, type ConcentrationWarning } from '@/lib/concentration';
import { AlertTriangleIcon } from 'lucide-react';
import { YahooClient } from '@/market/yahoo-client';
import { TickersRepo } from '@/domain/tickers';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { HoldingsRepo } from '@/domain/holdings';
import { syncStaleFunds, type SyncResult } from '@/market/fund-holdings-sync';

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
 * everything except plain cash/savings. Mirrors the investment-vs-cash split
 * called out in the schema (ACCOUNT_CASH / ACCOUNT_SAVINGS are the only
 * non-investment types).
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
    case 'HIGH': return 'text-destructive';
    case 'MEDIUM': return 'text-warning';
    case 'LOW':
    default: return 'text-info';
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

interface DriftRow {
  ticker: string;
  accountName: string;
  targetPct: number | null;
  actualPct: number;
  drift: number;
  value: number;
}

function computeDrift(valuations: HoldingValuation[]): DriftRow[] {
  // Ticker drift is pinned to the WITHIN-ACCOUNT basis: the stored
  // target_allocation_pct was authored per account (validated ≤100% per
  // account in holdings-validation.ts), so the apples-to-apples actual is the
  // holding's share of ITS account's total holding value — not the whole
  // household (which made multi-account drift meaningless). Class-level drift
  // (household basis) is computed separately in allocation-hierarchy.ts.
  //
  // Backend L1: key account totals on holding.accountId (a stable numeric id
  // carried on every HoldingValuation via `holding`), NOT the display
  // accountName — two same-named accounts must not be conflated. accountName is
  // retained only for the display row.
  const accountTotals = new Map<number, number>();
  for (const v of valuations) {
    accountTotals.set(v.holding.accountId, (accountTotals.get(v.holding.accountId) ?? 0) + v.value);
  }
  return valuations
    .map<DriftRow>((v) => {
      const accountTotal = accountTotals.get(v.holding.accountId) ?? 0;
      const actualPct = accountTotal === 0 ? 0 : v.value / accountTotal;
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
  const out: ReactNode[] = [];
  let compactRun: InvestmentsCardEntry[] = [];
  const flushCompact = () => {
    if (compactRun.length === 0) return;
    out.push(
      <div key={`grid-${compactRun[0].id}`} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {compactRun.map((c) => <div key={c.id}>{c.render()}</div>)}
      </div>,
    );
    compactRun = [];
  };
  for (const card of cards) {
    if (card.size === 'compact') { compactRun.push(card); continue; }
    flushCompact();
    out.push(<div key={card.id}>{card.render()}</div>);
  }
  flushCompact();
  return out;
}

export default function Investments() {
  const { filter, persons } = useViewFilter();

  const [editMode, setEditMode] = useState(false);

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const dependents = useDependentsStore((s) => s.dependents);
  const loadDependents = useDependentsStore((s) => s.load);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  // Settings drives the Investments card-layout overlay (id order + hidden
  // flags). null === default flow; see applyCardLayout() for semantics.
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const updateSettings = useSettingsStore((s) => s.update);
  // Tickers + fund holdings power the Concentration Health section below.
  // Loaded here so useConcentration() sees populated stores on first paint.
  const tickers = useTickersStore((s) => s.tickers);
  const loadTickers = useTickersStore((s) => s.load);
  const loadFundHoldings = useFundHoldingsStore((s) => s.load);
  const loadFundSectors = useFundSectorsStore((s) => s.load);

  useEffect(() => {
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
  // card measures "investments value", not total liquid assets. Derived from
  // visibleAccounts so the view filter (household / p1 / p2 / joint) flows
  // through: an account excluded by the filter never enters this set.
  const investmentAccountIds = useMemo(
    () =>
      new Set(
        visibleAccounts
          .filter((a) => INVESTMENT_ACCOUNT_TYPES.has(a.type))
          .map((a) => a.id)
          .filter((id): id is number => id != null),
      ),
    [visibleAccounts],
  );

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

  // "Refresh fund data" button state. Lets the user force a fund-holdings
  // sync without waiting for the next app restart — important when the
  // Per-Company donut is showing fund tickers (VTI, FXAIX) instead of the
  // look-through into underlying companies. The fast-forward `today` trick
  // below bypasses syncStaleFunds's 90-day staleness gate so the button
  // always refetches.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<SyncResult | null>(null);

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

  const handleRefreshFundData = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const db = getDatabase();
      // Pass a date 100 years in the future as `today` so every cached row
      // reads as older than STALE_DAYS — forces a refresh of every fund the
      // user holds. The constant in fund-holdings-sync stays untouched.
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 100);
      const result = await syncStaleFunds(
        {
          yahoo: new YahooClient(),
          fundHoldings: new FundHoldingsRepo(db),
          fundSectors: new FundSectorsRepo(db),
          tickers: new TickersRepo(db),
          holdings: new HoldingsRepo(db),
        },
        farFuture,
      );
      setRefreshResult(result);
      await loadFundHoldings();
      await loadFundSectors();
    } catch (err) {
      setRefreshResult({
        refreshed: [],
        skipped: [],
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setRefreshing(false);
    }
  };

  // "Force refresh sectors" — a focused debug affordance distinct from
  // "Refresh fund data". This button clears the fund_sectors table for the
  // user's held fund tickers, then calls Yahoo's sectorWeightings endpoint
  // sequentially per ticker so we can surface per-ticker status (ok /
  // empty / error) inline. Two prior fixes shipped that passed tests but
  // the donut stayed grey; this button makes whatever's still going wrong
  // visible to the user without needing to open dev tools.
  const [forceSectorsRunning, setForceSectorsRunning] = useState(false);
  interface SectorRefreshRow {
    ticker: string;
    status: 'ok' | 'empty' | 'error';
    sectorCount?: number;
    error?: string;
  }
  const [sectorRefreshRows, setSectorRefreshRows] = useState<SectorRefreshRow[] | null>(null);

  const handleForceRefreshSectors = async () => {
    setForceSectorsRunning(true);
    setSectorRefreshRows([]);
    const db = getDatabase();
    const yahoo = new YahooClient();
    const sectorsRepo = new FundSectorsRepo(db);
    const tickersRepo = new TickersRepo(db);
    const holdingsRepo = new HoldingsRepo(db);
    const fundClasses = new Set([
      'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
      'INTL_DEVELOPED', 'EMERGING_MARKETS', 'US_BONDS', 'INTL_BONDS', 'TIPS',
      'REAL_ESTATE', 'COMMODITIES',
    ]);
    try {
      const all = await holdingsRepo.listAll();
      const tickers = [...new Set(all.map((h) => h.ticker))];
      const fundTickers: string[] = [];
      for (const t of tickers) {
        const row = await tickersRepo.lookup(t);
        if (row && fundClasses.has(row.assetClass)) fundTickers.push(t);
      }
      // eslint-disable-next-line no-console
      console.log('[ForceRefreshSectors] candidates', { allTickers: tickers, fundTickers });

      const rows: SectorRefreshRow[] = [];
      for (const ticker of fundTickers) {
        try {
          // Fetch first, mutate the table only on success. The old code
          // DELETEd up front so a fetch failure left the row visibly empty,
          // but Yahoo's 429s now wipe the user's data on every retry. Only
          // a non-empty fetch earns the right to replace existing rows;
          // an empty fetch leaves prior rows intact (see the empty branch).
          const { sectors, asOf } = await yahoo.fundSectorWeightings(ticker);
          if (sectors.length === 0) {
            rows.push({ ticker, status: 'empty', sectorCount: 0 });
          } else {
            await db.execute('DELETE FROM fund_sectors WHERE fund_ticker = ?', [ticker]);
            await sectorsRepo.upsertSectors(ticker, sectors, asOf);
            rows.push({ ticker, status: 'ok', sectorCount: sectors.length });
          }
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : String(err);
          // Yahoo's getcrumb auth endpoint serves a generic 429 with no
          // Retry-After; surface a human-readable hint instead of a stack
          // trace so the user understands why the donut stayed grey.
          const message =
            rawMessage.includes('429') || /too many requests/i.test(rawMessage)
              ? 'Yahoo Finance rate-limited the auth endpoint — try again in ~10 minutes'
              : rawMessage;
          rows.push({ ticker, status: 'error', error: message });
        }
        setSectorRefreshRows([...rows]);
      }
      await loadFundSectors();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ForceRefreshSectors] outer failure', err);
      setSectorRefreshRows((prev) => [
        ...(prev ?? []),
        {
          ticker: '(setup)',
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setForceSectorsRunning(false);
    }
  };

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
  // `donut.assetAllocation.hidden`. We can't inject the picker into
  // DonutChartCard's CardHeader without modifying the primitive, so we
  // float it over the card via an absolute wrapper — same pattern as the
  // Assets / Liabilities donuts.
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

  const drift = useMemo(() => computeDrift(valuations), [valuations]);
  const driftWithTarget = useMemo(
    () => drift.filter((d) => d.targetPct != null),
    [drift],
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

  const cardRegistry: InvestmentsCardEntry[] = useMemo(
    () => [
      {
        id: 'time-series',
        label: 'Investments Over Time',
        size: 'wide',
        applicable: true,
        render: () => (
          <InvestmentTimeSeriesChart
            accounts={visibleAccounts}
            holdings={visibleHoldings}
            snapshots={visibleSnapshots}
          />
        ),
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
            <div className="relative" data-testid="asset-allocation-card">
              <div className="absolute top-4 right-4 z-10">
                <DonutEntityPicker
                  localStorageKey="donut.assetAllocation.hidden"
                  items={allocationPickerItems}
                />
              </div>
              {filteredAllocation.length > 0 ? (
                <DonutChartCard
                  title="Asset allocation"
                  subtitle="Approximate, using latest snapshot per account"
                  data={filteredAllocation}
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
        id: 'drift',
        label: 'Target vs Actual',
        size: 'wide',
        applicable: true,
        render: () => (
          /* Target / drift, full width below */
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
                            row.drift >= 0 ? 'text-success' : 'text-destructive'
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
        ),
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
      // time-series
      visibleAccounts,
      visibleHoldings,
      visibleSnapshots,
      // growth
      investmentsGrowth,
      // allocation
      allocation,
      allocationPickerItems,
      filteredAllocation,
      // class-targets
      heldClasses,
      settings?.assetClassTargetAllocations,
      updateSettings,
      // drift
      driftWithTarget,
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
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Investments</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Asset allocation, <TermTooltip term="DRIFT">drift</TermTooltip> from your targets, and contribution trends.
        </p>
        {/*
         * Empty-state pattern mirrors Goals (src/pages/Goals.tsx:435-442) so
         * the three "you haven't entered data yet" pages — Goals, Net Worth,
         * Investments — surface the same Card + friendly copy + primary-button
         * CTA. Prior layout was a single inline link to Inputs which dropped
         * the user into the sidebar with no obvious next step. Routing the
         * CTA at /inputs/accounts is the right entry: Investments combines
         * account-level holdings and snapshots — and accounts is the parent
         * of both. (529 plans also live under /inputs/accounts.)
         */}
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <div>No investment holdings yet — set up accounts and holdings in Inputs.</div>
            <Button asChild>
              <Link to="/inputs/accounts">Add an account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-semibold">Investments</h1>
            <FreshnessBadge size="sm" />
          </div>
          <p className="text-sm text-muted-foreground">
            Allocation across asset classes,{' '}
            <TermTooltip term="DRIFT">drift</TermTooltip> from your targets, and contribution trends.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshFundData}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing fund data…' : 'Refresh fund data'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceRefreshSectors}
              disabled={forceSectorsRunning}
              title="Clear and re-fetch fund sectors per ticker. Shows per-ticker status."
            >
              {forceSectorsRunning ? 'Refreshing sectors…' : 'Force refresh sectors'}
            </Button>
            {refreshResult && (
              <div className="text-xs text-muted-foreground">
                {refreshResult.refreshed.length > 0 && (
                  <span className="mr-3">
                    Refreshed: {refreshResult.refreshed.join(', ')}
                  </span>
                )}
                {refreshResult.skipped.length > 0 && (
                  <span className="mr-3">
                    Skipped: {refreshResult.skipped.join(', ')}
                  </span>
                )}
                {refreshResult.errors.length > 0 && (
                  <span className="text-destructive-soft-foreground">
                    Errors: {refreshResult.errors.join('; ')}
                  </span>
                )}
              </div>
            )}
          </div>
          {sectorRefreshRows && sectorRefreshRows.length > 0 && (
            <div
              className="mt-3 rounded-md border bg-muted/30 p-3 text-xs space-y-1"
              data-testid="force-sectors-status"
            >
              <div className="font-medium text-foreground">Force-refresh sectors status</div>
              {sectorRefreshRows.map((row) => (
                <div key={row.ticker} className="flex items-center gap-2 font-mono">
                  <span className="w-16">{row.ticker}</span>
                  {row.status === 'ok' && (
                    <span className="text-success">
                      ok · {row.sectorCount} sectors loaded
                    </span>
                  )}
                  {row.status === 'empty' && (
                    <span className="text-warning">
                      empty · Yahoo returned no sectorWeightings (bond/commodity fund?)
                    </span>
                  )}
                  {row.status === 'error' && (
                    <span className="text-destructive-soft-foreground">error · {row.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
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
    </div>
  );
}
