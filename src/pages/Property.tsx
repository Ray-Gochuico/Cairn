import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePropertiesStore } from '@/stores/properties-store';
import { useLoansStore } from '@/stores/loans-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { resolveUtilityCategoryIds } from '@/lib/category-config';
import { monthlyHousingObligation } from '@/lib/recurring-obligations';
import { CategoryMultiSelect } from '@/components/categories/CategoryMultiSelect';
import { LoanType } from '@/types/enums';
import { PROPERTY_TYPE_LABELS } from '@/components/forms/PropertyForm';
import {
  propertyCostBasis,
  rollingExpense,
  linkedSpendingTransactions,
  allLinkedSpending,
  averageMonthlySpending,
} from '@/lib/cost-basis';
import type {
  Property,
  Transaction,
  Category,
  HousingPayment,
} from '@/types/schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ValueEditor, EquityRow } from '@/components/AssetCardParts';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import ValueHistorySection from '@/components/inputs/ValueHistorySection';
import type { CsvColumn } from '@/lib/csv';

/**
 * Property page — Phase 4 split of the former "Property & Vehicles" combined
 * page. Displays equity cards per property. Cost basis and rolling-12mo
 * expense are wired in Part B.
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

interface PropertyAssetCardProps {
  property: Property;
  mortgageBalance: number | null;
  costBasis: number;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveValue: (value: number | null) => Promise<void>;
}

function PropertyAssetCard({
  property,
  mortgageBalance,
  costBasis,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveValue,
}: PropertyAssetCardProps) {
  const value = property.currentEstimatedValue ?? 0;
  const equity = value - (mortgageBalance ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{property.name}</CardTitle>
            <CardDescription className="text-xs">
              {PROPERTY_TYPE_LABELS[property.type]}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit value
          </Button>
        </div>
        {property.address ? (
          <div className="text-xs text-muted-foreground mt-1">
            {property.address}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Current value
          </div>
          <div className="text-2xl font-semibold">
            {formatCurrencyOrDash(property.currentEstimatedValue)}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Mortgage balance
            </dt>
            <dd className="font-mono">
              {mortgageBalance != null ? formatCurrency(mortgageBalance) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Purchase price
            </dt>
            <dd className="font-mono">
              {formatCurrencyOrDash(property.purchasePrice)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Cost basis
            </dt>
            <dd className="font-mono">
              {formatCurrency(costBasis)}
              <span className="ml-1 text-xs text-muted-foreground">
                (purchase price + capital improvements)
              </span>
            </dd>
          </div>
        </dl>

        <EquityRow label="Equity" value={equity} />

        {isEditing ? (
          <ValueEditor
            initialValue={property.currentEstimatedValue}
            onSave={onSaveValue}
            onCancel={onCancelEdit}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

interface PropertyExpensesCardProps {
  propertyName: string;
  rolling12moExpense: number;
  annualAverage: number;
  linkedTransactions: Transaction[];
}

function PropertyExpensesCard({
  propertyName,
  rolling12moExpense,
  annualAverage,
  linkedTransactions,
}: PropertyExpensesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Expenses</CardTitle>
        <CardDescription className="text-xs truncate">{propertyName}</CardDescription>
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
              No transactions linked to this property in the last 12 months.
              Edit a transaction on the Spending page and select this property
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

interface PropertyUtilitiesCardProps {
  propertyName: string;
  utilitiesCategoryFound: boolean;
  avgMonthlyUtilities: number;
  utilitiesTxCount: number;
  categories: Category[];
  selectedUtilityIds: number[];
  onSelectedUtilityIdsChange: (ids: number[]) => void;
}

function PropertyUtilitiesCard({
  propertyName,
  utilitiesCategoryFound,
  avgMonthlyUtilities,
  utilitiesTxCount,
  categories,
  selectedUtilityIds,
  onSelectedUtilityIdsChange,
}: PropertyUtilitiesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Utilities</CardTitle>
            <CardDescription className="text-xs truncate">{propertyName}</CardDescription>
          </div>
          <CategoryMultiSelect
            categories={categories}
            selected={selectedUtilityIds}
            onChange={onSelectedUtilityIdsChange}
            label="Edit utilities categories"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Average monthly
          </div>
          <div className="font-mono text-2xl">
            {utilitiesCategoryFound ? formatCurrency(avgMonthlyUtilities) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {!utilitiesCategoryFound
              ? 'No categories configured. Click the picker to choose some, or set defaults in Settings → Advanced.'
              : utilitiesTxCount === 0
                ? 'No utilities-categorized transactions linked to this property.'
                : `Across ${utilitiesTxCount} linked transaction${utilitiesTxCount === 1 ? '' : 's'}`}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RentalCardProps {
  rental: HousingPayment;
  ownerLabel: string;
  onRemove: () => void | Promise<void>;
}

function RentalCard({ rental, ownerLabel, onRemove }: RentalCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{rental.name}</CardTitle>
            <CardDescription className="text-xs">Rent</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/inputs/housing-payments" aria-label="Edit rental">
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
            {formatCurrency(rental.monthlyAmount)}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              From
            </dt>
            <dd className="font-mono">{rental.startDate}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Until
            </dt>
            <dd className="font-mono">{rental.endDate ?? 'ongoing'}</dd>
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

export default function Property() {
  const { filter, persons } = useViewFilter();

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);
  const updateProperty = usePropertiesStore((s) => s.update);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const transactionsError = useTransactionsStore((s) => s.error);

  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const categoriesError = useCategoriesStore((s) => s.error);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsError = useSettingsStore((s) => s.error);
  const updateSettings = useSettingsStore((s) => s.update);

  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const loadHousingPayments = useHousingPaymentsStore((s) => s.load);
  const housingPaymentsError = useHousingPaymentsStore((s) => s.error);
  const { confirm, dialog } = useConfirm();

  const [editing, setEditing] = useState<EditTarget>(null);

  const reload = () => {
    loadProperties();
    loadLoans();
    loadTransactions();
    loadCategories();
    loadSettings();
    loadHousingPayments();
  };
  useEffect(() => {
    loadProperties();
    loadLoans();
    loadTransactions();
    loadCategories();
    loadSettings();
    loadHousingPayments();
  }, [
    loadProperties,
    loadLoans,
    loadTransactions,
    loadCategories,
    loadSettings,
    loadHousingPayments,
  ]);

  const storeErrors = [
    propertiesError,
    loansError,
    transactionsError,
    categoriesError,
    settingsError,
    housingPaymentsError,
  ];
  const hasStoreError = storeErrors.some((e) => e != null);

  const visibleProperties = useMemo(
    () => filterByOwnerPersonId(properties, filter, persons),
    [properties, filter, persons],
  );

  const visibleRentals = useMemo(
    () => filterByOwnerPersonId(housingPayments, filter, persons),
    [housingPayments, filter, persons],
  );

  const today = new Date().toISOString().slice(0, 10);
  const totalMonthlyHousingObligation = useMemo(
    () => monthlyHousingObligation(visibleRentals, today),
    [visibleRentals, today],
  );

  // Resolve the effective category-id set for the Utilities card from the
  // user's saved configuration in app_settings (or the seeded
  // "Home > Utilities" fallback when nothing is configured). See
  // src/lib/category-config.ts for precedence rules.
  const utilitiesIds = useMemo(
    () =>
      resolveUtilityCategoryIds(
        settings?.propertyUtilitiesCategoryIds ?? null,
        categories,
        'property_utilities',
      ),
    [settings?.propertyUtilitiesCategoryIds, categories],
  );
  const utilitiesIdSet = useMemo(() => new Set(utilitiesIds), [utilitiesIds]);

  const mortgageById = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of loans) {
      if (l.type === LoanType.MORTGAGE && l.id != null) {
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

  const csvColumns = useMemo<CsvColumn<Property>[]>(
    () => [
      { header: 'name', value: (p) => p.name },
      { header: 'type', value: (p) => PROPERTY_TYPE_LABELS[p.type] },
      { header: 'address', value: (p) => p.address },
      { header: 'purchase date', value: (p) => p.purchaseDate },
      { header: 'purchase price', value: (p) => p.purchasePrice },
      { header: 'current value', value: (p) => p.currentEstimatedValue },
      {
        header: 'owner',
        value: (p) =>
          p.ownerPersonId != null
            ? (personNameById.get(p.ownerPersonId) ?? '')
            : '',
      },
    ],
    [personNameById],
  );

  useEffect(() => {
    if (editing == null) return;
    if (!visibleProperties.some((p) => p.id === editing.id)) {
      setEditing(null);
    }
  }, [editing, visibleProperties]);

  if (properties.length === 0 && housingPayments.length === 0) {
    return (
      <PageContainer className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Property</h1>
          <p className="text-sm text-muted-foreground">
            Equity at a glance for each home.
          </p>
        </div>
        {hasStoreError ? (
          <StoreErrorBanner errors={storeErrors} onRetry={reload} />
        ) : (
          <EmptyState
            icon={Home}
            title="No properties yet"
            description="Add a property or rental in Inputs to see equity at a glance."
          >
            <Button asChild>
              <Link to="/inputs/properties">Add a property</Link>
            </Button>
          </EmptyState>
        )}
      </PageContainer>
    );
  }

  async function handleSaveProperty(id: number, value: number | null) {
    await updateProperty(id, { currentEstimatedValue: value });
    setEditing(null);
  }

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={storeErrors} onRetry={reload} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Property</h1>
          <p className="text-sm text-muted-foreground">
            Equity = current value − linked-loan balance.
          </p>
        </div>
        <ExportCsvButton baseName="properties" columns={csvColumns} rows={properties} />
      </div>

      <div className="space-y-6">
        {visibleProperties.map((p) => {
          const mortgageBalance = p.linkedLoanId != null
            ? mortgageById.get(p.linkedLoanId) ?? null
            : null;
          const isEditing = editing?.id === p.id;
          const costBasis = propertyCostBasis(p.purchasePrice, p.id!, transactions, categories);
          const linkedTransactions = linkedSpendingTransactions(transactions, { propertyId: p.id! }, 12, categories);
          const rolling12moExpense = rollingExpense(transactions, { propertyId: p.id! }, 12, categories);
          const allLinked = allLinkedSpending(transactions, { propertyId: p.id! }, categories);
          const annualAverage = averageMonthlySpending(allLinked) * 12;
          const utilitiesTx = allLinked.filter(
            (t) => t.categoryId != null && utilitiesIdSet.has(t.categoryId),
          );
          const avgMonthlyUtilities = averageMonthlySpending(utilitiesTx);
          return (
            <div key={p.id} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PropertyAssetCard
                  property={p}
                  mortgageBalance={mortgageBalance}
                  costBasis={costBasis}
                  isEditing={isEditing}
                  onEdit={() => setEditing({ id: p.id! })}
                  onCancelEdit={() => setEditing(null)}
                  onSaveValue={(v) => handleSaveProperty(p.id!, v)}
                />
                <PropertyExpensesCard
                  propertyName={p.name}
                  rolling12moExpense={rolling12moExpense}
                  annualAverage={annualAverage}
                  linkedTransactions={linkedTransactions}
                />
                <PropertyUtilitiesCard
                  propertyName={p.name}
                  utilitiesCategoryFound={utilitiesIds.length > 0}
                  avgMonthlyUtilities={avgMonthlyUtilities}
                  utilitiesTxCount={utilitiesTx.length}
                  categories={categories}
                  selectedUtilityIds={settings?.propertyUtilitiesCategoryIds ?? []}
                  onSelectedUtilityIdsChange={(ids) =>
                    void updateSettings({
                      propertyUtilitiesCategoryIds: ids.length === 0 ? null : ids,
                    })
                  }
                />
              </div>
              {p.id != null ? (
                <ValueHistorySection
                  ownerType="PROPERTY"
                  ownerId={p.id}
                  fallbackValue={p.currentEstimatedValue}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {visibleRentals.length > 0 && (
        <section aria-label="Rentals" className="space-y-3">
          <h2 className="text-xl font-semibold">Rentals</h2>
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total recurring housing
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(totalMonthlyHousingObligation)}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">
                    /mo
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {visibleRentals.length} active rental
                  {visibleRentals.length === 1 ? '' : 's'} · feeds Spending &amp;
                  What-If projection
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {visibleRentals.map((r) => (
              <RentalCard
                key={r.id}
                rental={r}
                ownerLabel={
                  r.ownerPersonId == null
                    ? 'Joint'
                    : (personNameById.get(r.ownerPersonId) ?? 'Unknown')
                }
                onRemove={async () => {
                  const ok = await confirm({
                    title: `Delete ${r.name}?`,
                    description: 'This permanently removes this rent/housing payment. This can’t be undone.',
                  });
                  if (ok) await useHousingPaymentsStore.getState().remove(r.id!);
                }}
              />
            ))}
            <Link
              to="/inputs/housing-payments"
              aria-label="Add rental"
              className="flex min-h-[96px] w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-medium text-primary transition-colors hover:bg-accent"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Add rental
            </Link>
          </div>
        </section>
      )}
      {dialog}
    </PageContainer>
  );
}
