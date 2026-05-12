import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePropertiesStore } from '@/stores/properties-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { PropertySchema, type Property } from '@/types/schema';
import { PropertyType, LoanType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FormValues = Omit<Property, 'id'>;

const DEFAULT_PROPERTY: FormValues = {
  householdId: 1,
  ownerPersonId: null,
  name: '',
  type: PropertyType.PRIMARY_RESIDENCE,
  address: null,
  purchaseDate: null,
  purchasePrice: null,
  currentEstimatedValue: null,
  linkedLoanId: null,
  excludedFromNetWorth: false,
};

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.PRIMARY_RESIDENCE]: 'Primary residence',
  [PropertyType.RENTAL]: 'Rental',
  [PropertyType.VACATION_HOME]: 'Vacation home',
  [PropertyType.LAND]: 'Land',
};

interface PropertyFormProps {
  initial: FormValues;
  persons: Array<{ id: number; name: string }>;
  mortgageLoans: Array<{ id: number; name: string }>;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}

function PropertyForm({ initial, persons, mortgageLoans, onSubmit, onCancel }: PropertyFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(PropertySchema.omit({ id: true })),
    defaultValues: initial,
  });

  const onlyOnePerson = persons.length === 1;
  const noPersons = persons.length === 0;

  // For single-person households, force ownership to that person so the schema validates.
  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('ownerPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  if (noPersons) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            Add a person first.
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Property details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} />
          </div>

          <div>
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('type')}
            >
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {!onlyOnePerson && (
            <fieldset>
              <legend className="text-sm font-medium mb-2">Owner</legend>
              <div className="flex flex-wrap gap-4">
                {persons.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="ownerPersonId"
                      value={String(p.id)}
                      checked={form.watch('ownerPersonId') === p.id}
                      onChange={() =>
                        form.setValue('ownerPersonId', p.id, { shouldDirty: true, shouldTouch: true })
                      }
                    />
                    {p.name}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ownerPersonId"
                    value=""
                    checked={form.watch('ownerPersonId') === null}
                    onChange={() =>
                      form.setValue('ownerPersonId', null, { shouldDirty: true, shouldTouch: true })
                    }
                  />
                  Joint
                </label>
              </div>
            </fieldset>
          )}

          <div>
            <Label htmlFor="address">Address (optional)</Label>
            <Input
              id="address"
              maxLength={200}
              {...form.register('address', { setValueAs: (v) => (v === '' ? null : v) })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="purchaseDate">Purchase date (optional)</Label>
              <Input
                id="purchaseDate"
                type="date"
                {...form.register('purchaseDate', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>
            <div>
              <Label htmlFor="purchasePrice">Purchase price ($, optional)</Label>
              <Input
                id="purchasePrice"
                type="number"
                step="any"
                {...form.register('purchasePrice', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="currentEstimatedValue">Current estimated value ($, optional)</Label>
            <Input
              id="currentEstimatedValue"
              type="number"
              step="any"
              {...form.register('currentEstimatedValue', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
            />
          </div>

          <div>
            <Label htmlFor="linkedLoanId">Linked mortgage (optional)</Label>
            <select
              id="linkedLoanId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('linkedLoanId', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
            >
              <option value="">None</option>
              {mortgageLoans.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('excludedFromNetWorth')} />
              Exclude from net worth
            </label>
          </div>
        </CardContent>
      </Card>

      {Object.keys(form.formState.errors).length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="font-medium mb-1">Fix these before saving:</div>
          <ul className="list-disc pl-5">
            {Object.entries(form.formState.errors).map(([field, err]) => (
              <li key={field}>
                <span className="font-mono">{field}</span>:{' '}
                {(err as { message?: string })?.message ?? 'invalid'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={form.formState.isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

export default function PropertiesTab() {
  const { properties, load, create, update, remove } = usePropertiesStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
    loadLoans();
  }, [load, loadPersons, loadLoans]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!properties.some((p) => p.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, properties]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const mortgageLoanOptions = loans
    .filter((l) => l.type === LoanType.MORTGAGE)
    .map((l) => ({ id: l.id!, name: l.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add property</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Primary residence, rental, vacation home, or land.
        </p>
        <PropertyForm
          initial={DEFAULT_PROPERTY}
          persons={personOptions}
          mortgageLoans={mortgageLoanOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = properties.find((p) => p.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit property</h2>
        <PropertyForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            type: target.type,
            address: target.address,
            purchaseDate: target.purchaseDate,
            purchasePrice: target.purchasePrice,
            currentEstimatedValue: target.currentEstimatedValue,
            linkedLoanId: target.linkedLoanId,
            excludedFromNetWorth: target.excludedFromNetWorth,
          }}
          persons={personOptions}
          mortgageLoans={mortgageLoanOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Properties</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Homes, rentals, vacation properties, and land — with optional mortgage linkage.
      </p>

      {properties.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No properties added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {properties.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {PROPERTY_TYPE_LABELS[p.type]}
                    {p.currentEstimatedValue != null
                      ? ` · $${p.currentEstimatedValue.toLocaleString()}`
                      : ''}
                    {' · '}
                    {p.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(p.ownerPersonId) ?? 'Unknown owner'}
                    {p.excludedFromNetWorth ? ' · excluded from net worth' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: p.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(p.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Property</Button>
      </div>
    </div>
  );
}
