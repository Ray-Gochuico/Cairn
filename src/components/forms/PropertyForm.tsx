import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PropertySchema, type Property } from '@/types/schema';
import { PropertyType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary, useFormSubmit } from './form-errors';

export type PropertyFormValues = Omit<Property, 'id'>;

export const DEFAULT_PROPERTY: PropertyFormValues = {
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

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.PRIMARY_RESIDENCE]: 'Primary residence',
  [PropertyType.RENTAL]: 'Rental',
  [PropertyType.VACATION_HOME]: 'Vacation home',
  [PropertyType.LAND]: 'Land',
};

export interface PropertyFormProps {
  initial: PropertyFormValues;
  persons: Array<{ id: number; name: string }>;
  mortgageLoans: Array<{ id: number; name: string }>;
  onSubmit: (values: PropertyFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Standalone property form. Used by both PropertiesTab and the SetupWizard
 * Step 7 onboarding flow.
 */
export default function PropertyForm({
  initial,
  persons,
  mortgageLoans,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: PropertyFormProps) {
  const form = useForm<PropertyFormValues>({
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

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="purchaseDate">Purchase date (optional)</Label>
              <DatePicker
                id="purchaseDate"
                label="Purchase date"
                value={form.watch('purchaseDate') ?? ''}
                onChange={(v) =>
                  form.setValue('purchaseDate', v === '' ? null : v, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
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
            {/* Round-2 A4 disclosure: exclusion hides the asset but NOT its
                linked debt — net worth then carries the mortgage with no
                offsetting value. Valuation unchanged by design (link-exclusion
                is an owner-level modeling decision). */}
            {form.watch('excludedFromNetWorth') && form.watch('linkedLoanId') != null && (
              <p
                role="note"
                data-testid="excluded-linked-loan-note"
                className="mt-1 text-xs text-warning-foreground"
              >
                Linked mortgage still counts toward net worth — excluding this property hides the
                asset but keeps the debt.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

            <FormErrorSummary fieldErrors={form.formState.errors} submitError={submitError} />

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: submitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
