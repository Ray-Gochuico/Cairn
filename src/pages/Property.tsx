import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePropertiesStore } from '@/stores/properties-store';
import { useLoansStore } from '@/stores/loans-store';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { LoanType } from '@/types/enums';
import { PROPERTY_TYPE_LABELS } from '@/components/forms/PropertyForm';
import type { Property } from '@/types/schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

interface ValueEditorProps {
  initialValue: number | null;
  onSave: (value: number | null) => Promise<void>;
  onCancel: () => void;
}

function ValueEditor({ initialValue, onSave, onCancel }: ValueEditorProps) {
  const [text, setText] = useState<string>(
    initialValue != null ? String(initialValue) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const trimmed = text.trim();
    let parsed: number | null;
    if (trimmed === '') {
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        setError('Enter a non-negative number, or leave blank to clear.');
        return;
      }
      parsed = n;
    }
    setSaving(true);
    try {
      await onSave(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3 space-y-2">
      <Label htmlFor="value-editor-input" className="text-xs">
        Current estimated value
      </Label>
      <Input
        id="value-editor-input"
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={saving}
      />
      {error ? (
        <div className="text-xs text-red-600">{error}</div>
      ) : null}
      <div className="flex gap-2 justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

interface EquityRowProps {
  label: string;
  value: number;
  tone?: 'negative';
}

function EquityRow({ label, value, tone }: EquityRowProps) {
  const isNegative = tone === 'negative' || value < 0;
  return (
    <div className="flex items-center justify-between border-t pt-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-lg font-semibold ${
          isNegative ? 'text-red-600' : 'text-emerald-600'
        }`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

interface PropertyCardProps {
  property: Property;
  mortgageBalance: number | null;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveValue: (value: number | null) => Promise<void>;
}

function PropertyCard({
  property,
  mortgageBalance,
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
              {formatCurrencyOrDash(property.purchasePrice)}
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

type EditTarget = null | { id: number };

export default function Property() {
  const { filter, persons } = useViewFilter();

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const updateProperty = usePropertiesStore((s) => s.update);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  const [editing, setEditing] = useState<EditTarget>(null);

  useEffect(() => {
    loadProperties();
    loadLoans();
  }, [loadProperties, loadLoans]);

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

  useEffect(() => {
    if (editing == null) return;
    if (!visibleProperties.some((p) => p.id === editing.id)) {
      setEditing(null);
    }
  }, [editing, visibleProperties]);

  if (visibleProperties.length === 0) {
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
      <div>
        <h1 className="text-2xl font-semibold mb-1">Property</h1>
        <p className="text-sm text-muted-foreground">
          Equity = current value − linked-loan balance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {visibleProperties.map((p) => {
          const mortgageBalance = p.linkedLoanId != null
            ? mortgageById.get(p.linkedLoanId) ?? null
            : null;
          const isEditing = editing?.id === p.id;
          return (
            <PropertyCard
              key={p.id}
              property={p}
              mortgageBalance={mortgageBalance}
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
