import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import AssetValueChart from '@/components/charts/AssetValueChart';
import AssetsDonut from '@/components/charts/AssetsDonut';
import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';
import GrowthCard from '@/components/charts/GrowthCard';
import { computeHorizonGrowth } from '@/lib/growth-horizons';
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

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);
  // Accounts are loaded so the view filter can scope snapshots to accounts
  // owned by the selected person (snapshots themselves carry no owner field;
  // they inherit ownership from their parent account).
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  // Asset value snapshots feed the GrowthCard's as-of factory (property /
  // vehicle histories with purchase anchoring — same inputs as the chart).
  const assetValueSnapshots = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots,
  );
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);
  const assetValueSnapshotsError = useAssetValueSnapshotsStore((s) => s.error);

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
  useEffect(() => {
    reload();
  }, [reload]);

  const storeErrors = [
    snapshotsError,
    propertiesError,
    vehiclesError,
    loansError,
    accountsError,
    assetValueSnapshotsError,
  ];
  const hasStoreError = storeErrors.some((e) => e != null);

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
      todayIso: new Date().toISOString().slice(0, 10),
    });
    return computeHorizonGrowth(valueAsOf, new Date());
  }, [visibleSnapshots, accounts, visibleProperties, visibleVehicles, visibleLoans, assetValueSnapshots]);

  if (!hasAnyData) {
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
         * normalized EmptyState. The CTA routes to /inputs/accounts — Net Worth
         * combines account snapshots, properties, vehicles, and loan balances,
         * and accounts is where most users start.
         */}
        {hasStoreError ? (
          <StoreErrorBanner errors={storeErrors} onRetry={reload} />
        ) : (
          <EmptyState
            icon={Wallet}
            title="No net worth snapshots yet"
            description="Set up your accounts in Inputs to start tracking your wealth over time."
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
            <h1 className="text-2xl font-semibold">Net Worth</h1>
            <FreshnessBadge size="sm" />
          </div>
          <p className="text-sm text-muted-foreground">
            Investments include the latest confirmed snapshot per account.
          </p>
        </div>
        <ImportCsvButton entity="snapshot" />
      </div>

      {/* The hero: current value, range delta, area chart, breakdown. */}
      <AssetValueChart surface="netWorth" />

      {/* Horizon chips (1d…1y), numerically consistent with the chart
          header in household view via the shared as-of factory above
          (diverges intentionally under a person filter). */}
      <GrowthCard title="Net worth growth" horizons={netWorthGrowth} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AssetsDonut />
        <LiabilitiesDonut />
      </div>
    </PageContainer>
  );
}
