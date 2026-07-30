import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import {
  filterByObligorPersonId,
  filterByOwnerPersonId,
} from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { useViewScope } from '@/lib/use-view-scope';
import { partitionHidden, type HiddenPartition } from '@/lib/view-scope';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { FilteredEmptyState } from '@/components/layout/FilteredEmptyState';
import { ScopeCaption } from '@/components/layout/ScopeCaption';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import AssetValueChart from '@/components/charts/AssetValueChart';
import AssetsDonut from '@/components/charts/AssetsDonut';
import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';
import GrowthCard from '@/components/charts/GrowthCard';
import { computeHorizonGrowth } from '@/lib/growth-horizons';
import { useLocalToday } from '@/lib/use-local-today';
import { dateFromLocalISO } from '@/lib/dates';
import { netWorthAsOfFactory } from '@/lib/asset-value-chart';
import { filterSnapshotsForNetWorth } from '@/lib/account-inclusion';

/**
 * NetWorth page — the AssetValueChart hero + growth card + two donuts
 * (spec docs/superpowers/specs/2026-06-12-asset-value-chart-design.md §3.7,
 * "one fact, one place"). The page is thin: it loads the relevant stores,
 * applies the view filter, feeds GrowthCard through the same as-of factory
 * the chart uses, and hands everything else to the chart/donut components.
 *
 * The chart header is the single current-value + range-delta source; MoM/YoY
 * live in GrowthCard's 1m/1y horizons. The former MetricCard tiles and the
 * stacked-bar time-series chart are removed — see git history for the
 * previous implementation.
 */

export default function NetWorth() {
  const { filter, persons } = useViewFilter();
  const { personName } = useViewScope();

  // W14 chart merge: the hero toggles between the whole-net-worth surface and
  // the (former Investments-page) investment-accounts surface. ?chart=
  // investments is the deep-link/redirect target; `replace: true` keeps the
  // toggle out of Back-button history. Each surface's persisted prefs,
  // Included picker, and breakdown behavior ride along unchanged (per-surface
  // config is self-contained in AssetValueChart).
  const [searchParams, setSearchParams] = useSearchParams();
  const chart = searchParams.get('chart') === 'investments' ? 'investments' : 'total';
  const setChart = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'investments') next.set('chart', 'investments');
          else next.delete('chart');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);
  const snapshotsLoading = useSnapshotsStore((s) => s.isLoading);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);
  const propertiesLoading = usePropertiesStore((s) => s.isLoading);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const vehiclesLoading = useVehiclesStore((s) => s.isLoading);
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);
  const loansLoading = useLoansStore((s) => s.isLoading);
  // Accounts are loaded so the view filter can scope snapshots to accounts
  // owned by the selected person (snapshots themselves carry no owner field;
  // they inherit ownership from their parent account).
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  // Asset value snapshots feed the GrowthCard's as-of factory (property /
  // vehicle histories with purchase anchoring — same inputs as the chart).
  const assetValueSnapshots = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots,
  );
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);
  const assetValueSnapshotsError = useAssetValueSnapshotsStore((s) => s.error);
  const assetValueSnapshotsLoading = useAssetValueSnapshotsStore(
    (s) => s.isLoading,
  );

  const reload = useCallback(() => {
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadLoans();
    loadAccounts();
    loadAssetValueSnapshots();
  }, [
    loadSnapshots,
    loadProperties,
    loadVehicles,
    loadLoans,
    loadAccounts,
    loadAssetValueSnapshots,
  ]);

  const storeErrors = [
    snapshotsError,
    propertiesError,
    vehiclesError,
    loansError,
    accountsError,
    assetValueSnapshotsError,
  ];
  const hasStoreError = storeErrors.some((e) => e != null);

  // W10 M5: the hook owns the mount load and defines "settled" so we never
  // show "No net worth snapshots yet" while the six loads are in flight.
  const gate = useLoadGate(
    [
      snapshotsLoading,
      accountsLoading,
      propertiesLoading,
      vehiclesLoading,
      loansLoading,
      assetValueSnapshotsLoading,
    ],
    storeErrors,
    reload,
  );

  // Apply the view filter as the data-prep step — every derivation below
  // reads from these filtered slices and stays oblivious to the dropdown.
  // (The AssetValueChart is the exception: it is household-scoped BY DESIGN
  // — spec §3.1 — and flags that with a "· Household" label suffix.)
  const visibleAccounts = useMemo(
    () => filterByOwnerPersonId(accounts, filter, persons),
    [accounts, filter, persons],
  );
  const visibleAccountIds = useMemo(
    () =>
      new Set(
        visibleAccounts
          .map((a) => a.id)
          .filter((id): id is number => id != null),
      ),
    [visibleAccounts],
  );
  const visibleSnapshots = useMemo(
    () =>
      filter === 'household'
        ? snapshots
        : snapshots.filter((s) => visibleAccountIds.has(s.accountId)),
    [snapshots, filter, visibleAccountIds],
  );
  const visibleProperties = useMemo(
    () => filterByOwnerPersonId(properties, filter, persons),
    [properties, filter, persons],
  );
  const visibleVehicles = useMemo(
    () => filterByOwnerPersonId(vehicles, filter, persons),
    [vehicles, filter, persons],
  );
  const visibleLoans = useMemo(
    () => filterByObligorPersonId(loans, filter, persons),
    [loans, filter, persons],
  );

  const hasAnyData =
    visibleSnapshots.length > 0 ||
    visibleProperties.length > 0 ||
    visibleVehicles.length > 0 ||
    visibleLoans.length > 0;
  // Wave A D6 two-tier gate: onboarding copy only when the HOUSEHOLD is
  // empty; a view that filtered everything out gets the count-aware tier-2
  // state below, never "No net worth snapshots yet".
  const hasAnyHouseholdData =
    snapshots.length > 0 || properties.length > 0 || vehicles.length > 0 || loans.length > 0;

  // Summed exclusion partition across the four ownable entity kinds — feeds
  // both the tier-2 empty state and the nonempty ScopeCaption (C2).
  const pagePartition = useMemo<HiddenPartition>(() => {
    const parts = [
      partitionHidden(accounts, visibleAccounts, (a) => a.ownerPersonId),
      partitionHidden(properties, visibleProperties, (p) => p.ownerPersonId),
      partitionHidden(vehicles, visibleVehicles, (v) => v.ownerPersonId),
      partitionHidden(loans, visibleLoans, (l) => l.obligorPersonId),
    ];
    return parts.reduce((acc, p) => ({
      total: acc.total + p.total, visibleCount: acc.visibleCount + p.visibleCount,
      hiddenCount: acc.hiddenCount + p.hiddenCount, jointCount: acc.jointCount + p.jointCount,
      otherCount: acc.otherCount + p.otherCount,
    }));
  }, [accounts, visibleAccounts, properties, visibleProperties, vehicles, visibleVehicles, loans, visibleLoans]);

  // Live LOCAL day (Wave 11 T9) — feeds both the as-of valuation and the
  // growth "now" so they never drift across a midnight flip.
  const todayISO = useLocalToday();

  // GrowthCard refeed (spec §3.7): same as-of valuation as the chart, so in
  // the household view its horizons and the chart header always agree. Under
  // a person filter they intentionally diverge — GrowthCard follows the
  // visible* slices; the chart stays household-scoped (§3.1, "· Household").
  const netWorthGrowth = useMemo(() => {
    const valueAsOf = netWorthAsOfFactory({
      // Excluded accounts opt out of net worth (shared selector) — the chart
      // filters them when building its eligible set, so without this filter
      // the growth card and the chart header would disagree. The factory
      // already drops excluded properties/vehicles itself.
      snapshots: filterSnapshotsForNetWorth(visibleSnapshots, accounts),
      properties: visibleProperties,
      vehicles: visibleVehicles,
      loans: visibleLoans,
      assetValueSnapshots,
      todayIso: todayISO,
    });
    return computeHorizonGrowth(valueAsOf, dateFromLocalISO(todayISO));
  }, [visibleSnapshots, accounts, visibleProperties, visibleVehicles, visibleLoans, assetValueSnapshots, todayISO]);

  // W10 M5: never show "No net worth snapshots yet" while loads are in
  // flight — the empty copy is only honest once every consumed store settled.
  if (!gate.settled) {
    return (
      <PageContainer className="space-y-6">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  if (!hasAnyHouseholdData) {
    return (
      <PageContainer className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
            <p className="text-sm text-muted-foreground">
              Track your wealth over time across accounts, property, vehicles,
              and debt.
            </p>
          </div>
          <ImportCsvButton entity="snapshot" />
        </div>
        {/*
         * Distinguish "empty because new" from "empty because the load failed":
         * a consumed-store error shows the recoverable banner; otherwise the
         * normalized EmptyState. W14: the CTA routes to the Investments Manage
         * surface — accounts are managed where they're analyzed now.
         */}
        {hasStoreError ? (
          <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        ) : (
          <EmptyState
            icon={Wallet}
            title="No net worth snapshots yet"
            description="Set up your accounts on Investments to start tracking your wealth over time."
          >
            <Button asChild>
              <Link to="/investments?manage=accounts">Add an account</Link>
            </Button>
          </EmptyState>
        )}
      </PageContainer>
    );
  }

  // Wave A D6 tier 2: the household HAS data, the active view hid all of it.
  // Counts + "View household" — never onboarding copy, never an Add CTA.
  if (!hasAnyData) {
    return (
      <PageContainer className="space-y-6">
        <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
            <p className="text-sm text-muted-foreground">
              Track your wealth over time across accounts, property, vehicles,
              and debt.
            </p>
          </div>
          <ImportCsvButton entity="snapshot" />
        </div>
        <FilteredEmptyState
          noun="accounts, properties, vehicles, or loans"
          partition={pagePartition}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-semibold">Net Worth</h1>
            <FreshnessBadge size="sm" />
          </div>
          <p className="text-sm text-muted-foreground">
            Investments include the latest confirmed snapshot per account.
          </p>
          {/* Wave A C2: nonempty filtered views declare what the filter hid. */}
          <ScopeCaption noun="items" partition={pagePartition} />
        </div>
        <ImportCsvButton entity="snapshot" />
      </div>

      {/* The hero: current value, range delta, area chart, breakdown.
          W14: a two-option segmented control swaps the surface — "Everything"
          (net worth) vs "Investment accounts" (the chart that used to live on
          the Investments page). */}
      <Tabs value={chart} onValueChange={setChart}>
        <TabsList aria-label="Hero chart scope">
          <TabsTrigger value="total">Everything</TabsTrigger>
          <TabsTrigger value="investments">Investment accounts</TabsTrigger>
        </TabsList>
      </Tabs>
      <AssetValueChart surface={chart === 'investments' ? 'investments' : 'netWorth'} />

      {/* Horizon chips (1d…1y), numerically consistent with the chart
          header in household view via the shared as-of factory above
          (diverges intentionally under a person filter). */}
      {/* Wave A D4: GrowthCard follows the visible* slices, so under a
          filter its title names the scope. */}
      <GrowthCard
        title={`Net worth growth${filter === 'household' ? '' : filter === 'joint' ? ' · Joint' : ` · ${personName}`}`}
        horizons={netWorthGrowth}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AssetsDonut />
        <LiabilitiesDonut />
      </div>
    </PageContainer>
  );
}
