import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePropertiesStore } from '@/stores/properties-store';
import { useLoansStore } from '@/stores/loans-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { LoanType } from '@/types/enums';
import { PROPERTY_TYPE_LABELS } from '@/components/forms/PropertyForm';
import { propertyCostBasis, rollingExpense, linkedSpendingTransactions } from '@/lib/cost-basis';
import type { Property, Transaction } from '@/types/schema';
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

interface PropertyCardProps {
  property: Property;
  mortgageBalance: number | null;
  costBasis: number;
  rolling12moExpense: number;
  linkedTransactions: Transaction[];
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveValue: (value: number | null) => Promise<void>;
}

function PropertyCard({
  property,
  mortgageBalance,
  costBasis,
  rolling12moExpense,
  linkedTransactions,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveValue,
}: PropertyCardProps) {
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
          <div className="col-span-2">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              12-mo expense
            </dt>
            <dd className="font-mono">{formatCurrency(rolling12moExpense)}</dd>
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

type EditTarget = null | { id: number };

export default function Property() {
  const { filter, persons } = useViewFilter();

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const updateProperty = usePropertiesStore((s) => s.update);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);

  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);

  const [editing, setEditing] = useState<EditTarget>(null);

  useEffect(() => {
    loadProperties();
    loadLoans();
    loadTransactions();
    loadCategories();
  }, [loadProperties, loadLoans, loadTransactions, loadCategories]);

  const visibleProperties = useMemo(
    () => filterByOwnerPersonId(properties, filter, persons),
    [properties, filter, persons],
  );

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

  if (properties.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Property</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Equity at a glance for each home.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Add properties from{' '}
            <Link to="/inputs/properties" className="underline text-foreground">
              Inputs
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSaveProperty(id: number, value: number | null) {
    await updateProperty(id, { currentEstimatedValue: value });
    setEditing(null);
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Property</h1>
          <p className="text-sm text-muted-foreground">
            Equity = current value − linked-loan balance.
          </p>
        </div>
        <ExportCsvButton baseName="properties" columns={csvColumns} rows={properties} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {visibleProperties.map((p) => {
          const mortgageBalance = p.linkedLoanId != null
            ? mortgageById.get(p.linkedLoanId) ?? null
            : null;
          const isEditing = editing?.id === p.id;
          const costBasis = propertyCostBasis(p.purchasePrice, p.id!, transactions, categories);
          const linkedTransactions = linkedSpendingTransactions(transactions, { propertyId: p.id! }, 12, categories);
          const rolling12moExpense = rollingExpense(transactions, { propertyId: p.id! }, 12, categories);
          return (
            <PropertyCard
              key={p.id}
              property={p}
              mortgageBalance={mortgageBalance}
              costBasis={costBasis}
              rolling12moExpense={rolling12moExpense}
              linkedTransactions={linkedTransactions}
              isEditing={isEditing}
              onEdit={() => setEditing({ id: p.id! })}
              onCancelEdit={() => setEditing(null)}
              onSaveValue={(v) => handleSaveProperty(p.id!, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
