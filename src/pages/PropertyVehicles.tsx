import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { filterByOwnerPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { LoanType } from '@/types/enums';
import { PROPERTY_TYPE_LABELS } from '@/components/forms/PropertyForm';
import type { Property, Vehicle } from '@/types/schema';
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
 * Property & Vehicles page — Phase 2 visualization surface.
 *
 * Side-by-side equity cards. Mortgage / auto-loan balances are resolved
 * via the corresponding linked loan in the loans store. "Edit value" uses
 * a small inline form (toggled by id) rather than a Radix Dialog — Phase 1
 * established that Radix Dialog is jsdom-flaky for component tests, and a
 * conditional inline form is sufficient for this page's needs.
 *
 * Cost basis is a Phase 2 stub equal to purchase price; Phase 4 adds the
 * capital-improvements aggregation per the plan.
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

/**
 * Tiny "Edit value" inline form. Toggled visible from the parent card by
 * passing the open state via props. Kept stateless w.r.t. the entity ID —
 * the parent owns which card is being edited.
 */
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
                (capital improvements arrive in Phase 4)
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

interface VehicleCardProps {
  vehicle: Vehicle;
  loanBalance: number | null;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveValue: (value: number | null) => Promise<void>;
}

function VehicleCard({
  vehicle,
  loanBalance,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveValue,
}: VehicleCardProps) {
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

type EditTarget =
  | null
  | { kind: 'property'; id: number }
  | { kind: 'vehicle'; id: number };

export default function PropertyVehicles() {
  const { filter, persons } = useViewFilter();

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const updateProperty = usePropertiesStore((s) => s.update);

  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const updateVehicle = useVehiclesStore((s) => s.update);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  const [editing, setEditing] = useState<EditTarget>(null);

  useEffect(() => {
    loadProperties();
    loadVehicles();
    loadLoans();
  }, [loadProperties, loadVehicles, loadLoans]);

  // Filter properties + vehicles by the household / p1 / p2 / joint dropdown.
  // Loans aren't filtered here — they're a lookup source (linked-loan
  // balance per property/vehicle), not a thing rendered in its own section.
  const visibleProperties = useMemo(
    () => filterByOwnerPersonId(properties, filter, persons),
    [properties, filter, persons],
  );
  const visibleVehicles = useMemo(
    () => filterByOwnerPersonId(vehicles, filter, persons),
    [vehicles, filter, persons],
  );

  /**
   * Build a quick lookup of mortgage balances keyed by the linked loan id.
   * Both property → loan and the requirement "type === MORTGAGE" come from
   * the plan; if a user mis-types the loan type, we don't surface a balance
   * here — the safer default than showing a non-mortgage balance against a
   * property.
   */
  const mortgageById = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of loans) {
      if (l.type === LoanType.MORTGAGE && l.id != null) {
        map.set(l.id, l.currentBalance);
      }
    }
    return map;
  }, [loans]);

  const autoLoanById = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of loans) {
      if (l.type === LoanType.AUTO && l.id != null) {
        map.set(l.id, l.currentBalance);
      }
    }
    return map;
  }, [loans]);

  // Reset stale editing target when its entity disappears (e.g. deleted in
  // another tab, or hidden by the view filter). We watch the visible* slices
  // so flipping the filter to a person who doesn't own the currently-editing
  // entity cleanly drops the inline editor instead of stranding it.
  useEffect(() => {
    if (editing == null) return;
    if (editing.kind === 'property' && !visibleProperties.some((p) => p.id === editing.id)) {
      setEditing(null);
    } else if (editing.kind === 'vehicle' && !visibleVehicles.some((v) => v.id === editing.id)) {
      setEditing(null);
    }
  }, [editing, visibleProperties, visibleVehicles]);

  const hasAny = visibleProperties.length > 0 || visibleVehicles.length > 0;

  if (!hasAny) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Property & Vehicles</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Equity at a glance for each home and vehicle.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Add properties or vehicles from{' '}
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

  async function handleSaveVehicle(id: number, value: number | null) {
    await updateVehicle(id, { currentEstimatedValue: value });
    setEditing(null);
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Property & Vehicles</h1>
        <p className="text-sm text-muted-foreground">
          Equity = current value − linked-loan balance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Properties</h2>
          {visibleProperties.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No properties yet.
              </CardContent>
            </Card>
          ) : (
            visibleProperties.map((p) => {
              const mortgageBalance = p.linkedLoanId != null
                ? mortgageById.get(p.linkedLoanId) ?? null
                : null;
              const isEditing = editing?.kind === 'property' && editing.id === p.id;
              return (
                <PropertyCard
                  key={p.id}
                  property={p}
                  mortgageBalance={mortgageBalance}
                  isEditing={isEditing}
                  onEdit={() => setEditing({ kind: 'property', id: p.id! })}
                  onCancelEdit={() => setEditing(null)}
                  onSaveValue={(v) => handleSaveProperty(p.id!, v)}
                />
              );
            })
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Vehicles</h2>
          {visibleVehicles.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No vehicles yet.
              </CardContent>
            </Card>
          ) : (
            visibleVehicles.map((v) => {
              const loanBalance = v.linkedLoanId != null
                ? autoLoanById.get(v.linkedLoanId) ?? null
                : null;
              const isEditing = editing?.kind === 'vehicle' && editing.id === v.id;
              return (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  loanBalance={loanBalance}
                  isEditing={isEditing}
                  onEdit={() => setEditing({ kind: 'vehicle', id: v.id! })}
                  onCancelEdit={() => setEditing(null)}
                  onSaveValue={(val) => handleSaveVehicle(v.id!, val)}
                />
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
