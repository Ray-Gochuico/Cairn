import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { resolveUtilityCategoryIds } from '@/lib/category-config';
import { monthlyLeaseObligation } from '@/lib/recurring-obligations';
import { CategoryMultiSelect } from '@/components/categories/CategoryMultiSelect';
import { LoanType } from '@/types/enums';
import {
  rollingExpense,
  linkedSpendingTransactions,
  allLinkedSpending,
  averageMonthlySpending,
} from '@/lib/cost-basis';
import type {
  Vehicle,
  Transaction,
  Category,
  VehicleLease,
} from '@/types/schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ValueEditor, EquityRow } from '@/components/AssetCardParts';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import ValueHistorySection from '@/components/inputs/ValueHistorySection';
import type { CsvColumn } from '@/lib/csv';

/**
 * Vehicles page — Phase 4 split of the former "Property & Vehicles" combined
 * page. Displays equity cards per vehicle. Rolling-12mo expense is wired in
 * Part B.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatCurrencyOrDash(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatCurrency(value);
}

/** Format a vehicle's year/make/model into a single human line, omitting blanks. */
function describeVehicle(v: Vehicle): string {
  const parts = [
    v.year != null ? String(v.year) : null,
    v.make,
    v.model,
  ].filter((s): s is string => Boolean(s));
  return parts.join(' ');
}

interface VehicleAssetCardProps {
  vehicle: Vehicle;
  loanBalance: number | null;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveValue: (value: number | null) => Promise<void>;
}

function VehicleAssetCard({
  vehicle,
  loanBalance,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveValue,
}: VehicleAssetCardProps) {
  const value = vehicle.currentEstimatedValue ?? 0;
  const equity = value - (loanBalance ?? 0);
  const description = describeVehicle(vehicle);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{vehicle.name}</CardTitle>
            {description ? (
              <CardDescription className="text-xs">{description}</CardDescription>
            ) : null}
          </div>
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit value
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Current value
          </div>
          <div className="text-2xl font-semibold">
            {formatCurrencyOrDash(vehicle.currentEstimatedValue)}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Auto-loan balance
            </dt>
            <dd className="font-mono">
              {loanBalance != null ? formatCurrency(loanBalance) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Purchase price
            </dt>
            <dd className="font-mono">
              {formatCurrencyOrDash(vehicle.purchasePrice)}
            </dd>
          </div>
        </dl>

        <EquityRow label="Equity" value={equity} />

        {isEditing ? (
          <ValueEditor
            initialValue={vehicle.currentEstimatedValue}
            onSave={onSaveValue}
            onCancel={onCancelEdit}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

interface VehicleExpensesCardProps {
  vehicleName: string;
  rolling12moExpense: number;
  annualAverage: number;
  linkedTransactions: Transaction[];
}

function VehicleExpensesCard({
  vehicleName,
  rolling12moExpense,
  annualAverage,
  linkedTransactions,
}: VehicleExpensesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Expenses</CardTitle>
        <CardDescription className="text-xs truncate">{vehicleName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              12-mo rolling
            </dt>
            <dd className="font-mono text-lg">{formatCurrency(rolling12moExpense)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Annual average
            </dt>
            <dd className="font-mono text-lg">{formatCurrency(annualAverage)}</dd>
            <dd className="text-xs text-muted-foreground">
              over full history
            </dd>
          </div>
        </dl>

        <details className="text-sm">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
            Linked transactions ({linkedTransactions.length})
          </summary>
          {linkedTransactions.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No transactions linked to this vehicle in the last 12 months.
              Edit a transaction on the Spending page and select this vehicle
              to link it here.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto pr-1">
              {linkedTransactions.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground tabular-nums">{t.date}</span>
                  <span className="flex-1 truncate">{t.merchant}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </CardContent>
    </Card>
  );
}

interface VehicleGasCardProps {
  vehicleName: string;
  gasCategoryFound: boolean;
  avgMonthlyGas: number;
  gasTxCount: number;
  categories: Category[];
  selectedGasIds: number[];
  onSelectedGasIdsChange: (ids: number[]) => void;
}

function VehicleGasCard({
  vehicleName,
  gasCategoryFound,
  avgMonthlyGas,
  gasTxCount,
  categories,
  selectedGasIds,
  onSelectedGasIdsChange,
}: VehicleGasCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Gas</CardTitle>
            <CardDescription className="text-xs truncate">{vehicleName}</CardDescription>
          </div>
          <CategoryMultiSelect
            categories={categories}
            selected={selectedGasIds}
            onChange={onSelectedGasIdsChange}
            label="Edit gas categories"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Average monthly
          </div>
          <div className="font-mono text-2xl">
            {gasCategoryFound ? formatCurrency(avgMonthlyGas) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {!gasCategoryFound
              ? 'No categories configured. Click the picker to choose some, or set defaults in Settings → Advanced.'
              : gasTxCount === 0
                ? 'No gas-categorized transactions linked to this vehicle.'
                : `Across ${gasTxCount} linked transaction${gasTxCount === 1 ? '' : 's'}`}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface LeaseCardProps {
  lease: VehicleLease;
  ownerLabel: string;
  onRemove: () => void;
}

function LeaseCard({ lease, ownerLabel, onRemove }: LeaseCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{lease.name}</CardTitle>
            <CardDescription className="text-xs">Lease</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/inputs/vehicle-leases" aria-label="Edit lease">
                Edit
              </Link>
            </Button>
            <Button size="sm" variant="destructive" onClick={onRemove}>
              Remove
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Monthly
          </div>
          <div className="text-2xl font-semibold">
            {formatCurrency(lease.monthlyAmount)}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              From
            </dt>
            <dd className="font-mono">{lease.startDate}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Until
            </dt>
            <dd className="font-mono">{lease.endDate ?? 'ongoing'}</dd>
          </div>
        </dl>
        <div className="pt-3 border-t">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            {ownerLabel}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

type EditTarget = null | { id: number };

export default function Vehicles() {
  const { filter, persons } = useViewFilter();

  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const updateVehicle = useVehiclesStore((s) => s.update);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);

  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const updateSettings = useSettingsStore((s) => s.update);

  const vehicleLeases = useVehicleLeasesStore((s) => s.vehicleLeases);
  const loadVehicleLeases = useVehicleLeasesStore((s) => s.load);

  const [editing, setEditing] = useState<EditTarget>(null);

  useEffect(() => {
    loadVehicles();
    loadLoans();
    loadTransactions();
    loadCategories();
    loadSettings();
    loadVehicleLeases();
  }, [
    loadVehicles,
    loadLoans,
    loadTransactions,
    loadCategories,
    loadSettings,
    loadVehicleLeases,
  ]);

  const visibleVehicles = useMemo(
    () => filterByOwnerPersonId(vehicles, filter, persons),
    [vehicles, filter, persons],
  );

  const visibleLeases = useMemo(
    () => filterByOwnerPersonId(vehicleLeases, filter, persons),
    [vehicleLeases, filter, persons],
  );

  const today = new Date().toISOString().slice(0, 10);
  const totalMonthlyLeaseObligation = useMemo(
    () => monthlyLeaseObligation(visibleLeases, today),
    [visibleLeases, today],
  );

  // Resolve the effective category-id set for the Gas card from the user's
  // saved configuration in app_settings (or the seeded "Vehicles > Gas/Fuel"
  // fallback when nothing is configured). See src/lib/category-config.ts for
  // precedence rules.
  const gasIds = useMemo(
    () =>
      resolveUtilityCategoryIds(
        settings?.vehicleGasCategoryIds ?? null,
        categories,
        'vehicle_gas',
      ),
    [settings?.vehicleGasCategoryIds, categories],
  );
  const gasIdSet = useMemo(() => new Set(gasIds), [gasIds]);

  const autoLoanById = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of loans) {
      if (l.type === LoanType.AUTO && l.id != null) {
        map.set(l.id, l.currentBalance);
      }
    }
    return map;
  }, [loans]);

  const personNameById = useMemo(
    () =>
      new Map(
        persons.filter((p) => p.id != null).map((p) => [p.id as number, p.name]),
      ),
    [persons],
  );

  const csvColumns = useMemo<CsvColumn<Vehicle>[]>(
    () => [
      { header: 'name', value: (v) => v.name },
      { header: 'year', value: (v) => v.year },
      { header: 'make', value: (v) => v.make },
      { header: 'model', value: (v) => v.model },
      { header: 'purchase date', value: (v) => v.purchaseDate },
      { header: 'purchase price', value: (v) => v.purchasePrice },
      { header: 'current value', value: (v) => v.currentEstimatedValue },
      {
        header: 'owner',
        value: (v) =>
          v.ownerPersonId != null
            ? (personNameById.get(v.ownerPersonId) ?? '')
            : '',
      },
    ],
    [personNameById],
  );

  useEffect(() => {
    if (editing == null) return;
    if (!visibleVehicles.some((v) => v.id === editing.id)) {
      setEditing(null);
    }
  }, [editing, visibleVehicles]);

  if (vehicles.length === 0 && vehicleLeases.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Vehicles</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Equity at a glance for each vehicle.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Add vehicles or leases from{' '}
            <Link to="/inputs/vehicles" className="underline text-foreground">
              Inputs
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSaveVehicle(id: number, value: number | null) {
    await updateVehicle(id, { currentEstimatedValue: value });
    setEditing(null);
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Vehicles</h1>
          <p className="text-sm text-muted-foreground">
            Equity = current value − linked-loan balance.
          </p>
        </div>
        <ExportCsvButton baseName="vehicles" columns={csvColumns} rows={vehicles} />
      </div>

      <div className="space-y-6">
        {visibleVehicles.map((v) => {
          const loanBalance = v.linkedLoanId != null
            ? autoLoanById.get(v.linkedLoanId) ?? null
            : null;
          const isEditing = editing?.id === v.id;
          const linkedTransactions = linkedSpendingTransactions(transactions, { vehicleId: v.id! }, 12, categories);
          const rolling12moExpense = rollingExpense(transactions, { vehicleId: v.id! }, 12, categories);
          const allLinked = allLinkedSpending(transactions, { vehicleId: v.id! }, categories);
          const annualAverage = averageMonthlySpending(allLinked) * 12;
          const gasTx = allLinked.filter(
            (t) => t.categoryId != null && gasIdSet.has(t.categoryId),
          );
          const avgMonthlyGas = averageMonthlySpending(gasTx);
          return (
            <div key={v.id} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <VehicleAssetCard
                  vehicle={v}
                  loanBalance={loanBalance}
                  isEditing={isEditing}
                  onEdit={() => setEditing({ id: v.id! })}
                  onCancelEdit={() => setEditing(null)}
                  onSaveValue={(val) => handleSaveVehicle(v.id!, val)}
                />
                <VehicleExpensesCard
                  vehicleName={v.name}
                  rolling12moExpense={rolling12moExpense}
                  annualAverage={annualAverage}
                  linkedTransactions={linkedTransactions}
                />
                <VehicleGasCard
                  vehicleName={v.name}
                  gasCategoryFound={gasIds.length > 0}
                  avgMonthlyGas={avgMonthlyGas}
                  gasTxCount={gasTx.length}
                  categories={categories}
                  selectedGasIds={settings?.vehicleGasCategoryIds ?? []}
                  onSelectedGasIdsChange={(ids) =>
                    void updateSettings({
                      vehicleGasCategoryIds: ids.length === 0 ? null : ids,
                    })
                  }
                />
              </div>
              {v.id != null ? (
                <ValueHistorySection
                  ownerType="VEHICLE"
                  ownerId={v.id}
                  fallbackValue={v.currentEstimatedValue}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {visibleLeases.length > 0 && (
        <section aria-label="Leases" className="space-y-3">
          <h2 className="text-xl font-semibold">Leases</h2>
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total recurring vehicle
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(totalMonthlyLeaseObligation)}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">
                    /mo
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {visibleLeases.length} active lease
                  {visibleLeases.length === 1 ? '' : 's'} · feeds Spending &amp;
                  What-If projection
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {visibleLeases.map((l) => (
              <LeaseCard
                key={l.id}
                lease={l}
                ownerLabel={
                  l.ownerPersonId == null
                    ? 'Joint'
                    : (personNameById.get(l.ownerPersonId) ?? 'Unknown')
                }
                onRemove={() =>
                  void useVehicleLeasesStore.getState().remove(l.id!)
                }
              />
            ))}
            <Link
              to="/inputs/vehicle-leases"
              aria-label="Add lease"
              className="flex min-h-[96px] w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-medium text-primary transition-colors hover:bg-accent"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Add lease
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
