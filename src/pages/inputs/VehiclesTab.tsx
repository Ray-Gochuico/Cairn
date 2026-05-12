import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { VehicleSchema, type Vehicle } from '@/types/schema';
import { LoanType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FormValues = Omit<Vehicle, 'id'>;

const DEFAULT_VEHICLE: FormValues = {
  householdId: 1,
  ownerPersonId: null,
  name: '',
  year: null,
  make: null,
  model: null,
  purchaseDate: null,
  purchasePrice: null,
  currentEstimatedValue: null,
  linkedLoanId: null,
  excludedFromNetWorth: false,
};

interface VehicleFormProps {
  initial: FormValues;
  persons: Array<{ id: number; name: string }>;
  autoLoans: Array<{ id: number; name: string }>;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}

function VehicleForm({ initial, persons, autoLoans, onSubmit, onCancel }: VehicleFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(VehicleSchema.omit({ id: true })),
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
        <CardHeader><CardTitle className="text-base">Vehicle details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="year">Year (optional)</Label>
              <Input
                id="year"
                type="number"
                {...form.register('year', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
              />
            </div>
            <div>
              <Label htmlFor="make">Make (optional)</Label>
              <Input
                id="make"
                maxLength={50}
                {...form.register('make', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>
            <div>
              <Label htmlFor="model">Model (optional)</Label>
              <Input
                id="model"
                maxLength={50}
                {...form.register('model', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>
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
            <Label htmlFor="linkedLoanId">Linked auto loan (optional)</Label>
            <select
              id="linkedLoanId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('linkedLoanId', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
            >
              <option value="">None</option>
              {autoLoans.map((l) => (
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

export default function VehiclesTab() {
  const { vehicles, load, create, update, remove } = useVehiclesStore();
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
      if (!vehicles.some((v) => v.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, vehicles]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const autoLoanOptions = loans
    .filter((l) => l.type === LoanType.AUTO)
    .map((l) => ({ id: l.id!, name: l.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add vehicle</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Cars, trucks, motorcycles, boats — with optional auto-loan linkage.
        </p>
        <VehicleForm
          initial={DEFAULT_VEHICLE}
          persons={personOptions}
          autoLoans={autoLoanOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = vehicles.find((v) => v.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit vehicle</h2>
        <VehicleForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            year: target.year,
            make: target.make,
            model: target.model,
            purchaseDate: target.purchaseDate,
            purchasePrice: target.purchasePrice,
            currentEstimatedValue: target.currentEstimatedValue,
            linkedLoanId: target.linkedLoanId,
            excludedFromNetWorth: target.excludedFromNetWorth,
          }}
          persons={personOptions}
          autoLoans={autoLoanOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Vehicles</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Cars, trucks, motorcycles, and boats — with optional auto-loan linkage.
      </p>

      {vehicles.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No vehicles added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {vehicles.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'No year/make/model'}
                    {v.currentEstimatedValue != null
                      ? ` · $${v.currentEstimatedValue.toLocaleString()}`
                      : ''}
                    {' · '}
                    {v.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(v.ownerPersonId) ?? 'Unknown owner'}
                    {v.excludedFromNetWorth ? ' · excluded from net worth' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: v.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(v.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Vehicle</Button>
      </div>
    </div>
  );
}
