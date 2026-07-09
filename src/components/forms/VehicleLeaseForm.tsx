import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { localTodayISO } from '@/lib/dates';
import {
  VehicleLeaseBaseSchema,
  type VehicleLease,
} from '@/types/schema';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

export type VehicleLeaseFormValues = Omit<VehicleLease, 'id'>;

// Zod 4 disallows .omit() on a refined object schema. Strip the id first,
// then re-apply the end>=start cross-field refinement for the form resolver.
const VehicleLeaseFormSchema = VehicleLeaseBaseSchema
  .omit({ id: true })
  .refine((v) => v.endDate == null || v.endDate >= v.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export const DEFAULT_VEHICLE_LEASE: VehicleLeaseFormValues = {
  householdId: 1,
  ownerPersonId: null,
  name: '',
  monthlyAmount: 0,
  // Filled with the LOCAL calendar day at form mount (Wave 11 T10) — empty
  // here to avoid a module-load-frozen UTC default.
  startDate: '',
  endDate: null,
};

export interface VehicleLeaseFormProps {
  initial: VehicleLeaseFormValues;
  persons: Array<{ id: number; name: string }>;
  onSubmit: (values: VehicleLeaseFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Canonical vehicle lease form. Shared by VehiclesTab's sibling input
 * tab (VehicleLeasesTab) and the Setup Wizard.
 */
export default function VehicleLeaseForm({
  initial,
  persons,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: VehicleLeaseFormProps) {
  const defaults = useMemo(
    () => ({ ...initial, startDate: initial.startDate || localTodayISO() }),
    [initial],
  );
  const form = useForm<VehicleLeaseFormValues>({
    resolver: zodResolver(VehicleLeaseFormSchema),
    defaultValues: defaults,
  });

  const onlyOnePerson = persons.length === 1;

  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('ownerPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vehicle lease</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Label</Label>
            {/* Round-3 S6: the house trio — aria-invalid + aria-describedby
                + FieldError — on every field (AccountForm pattern). */}
            <Input
              id="name"
              placeholder="e.g. Tesla Model 3 lease"
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
              aria-describedby={form.formState.errors.name ? 'lease-name-error' : undefined}
            />
            <FieldError id="lease-name-error" message={form.formState.errors.name?.message} />
          </div>

          <div>
            <Label htmlFor="monthlyAmount">Monthly amount ($)</Label>
            <Input
              id="monthlyAmount"
              type="number"
              step="any"
              {...form.register('monthlyAmount', {
                setValueAs: (v) => (v === '' ? 0 : Number(v)),
              })}
              aria-invalid={form.formState.errors.monthlyAmount ? true : undefined}
              aria-describedby={form.formState.errors.monthlyAmount ? 'lease-monthly-amount-error' : undefined}
            />
            <FieldError id="lease-monthly-amount-error" message={form.formState.errors.monthlyAmount?.message} />
          </div>

          {!onlyOnePerson && persons.length > 0 && (
            <fieldset
              aria-describedby={form.formState.errors.ownerPersonId ? 'lease-owner-error' : undefined}
            >
              <legend className="text-sm font-medium mb-2">Who pays this?</legend>
              <div className="flex flex-wrap gap-4">
                {persons.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="ownerPersonId"
                      value={String(p.id)}
                      checked={form.watch('ownerPersonId') === p.id}
                      onChange={() =>
                        form.setValue('ownerPersonId', p.id, {
                          shouldDirty: true,
                          shouldTouch: true,
                        })
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
                      form.setValue('ownerPersonId', null, {
                        shouldDirty: true,
                        shouldTouch: true,
                      })
                    }
                  />
                  Joint
                </label>
              </div>
              <FieldError id="lease-owner-error" message={form.formState.errors.ownerPersonId?.message} />
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              aria-describedby={form.formState.errors.startDate ? 'lease-start-date-error' : undefined}
            >
              <Label htmlFor="startDate">Start date</Label>
              <DatePicker
                id="startDate"
                label="Start date"
                value={form.watch('startDate')}
                onChange={(v) =>
                  form.setValue('startDate', v, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
              />
              <FieldError id="lease-start-date-error" message={form.formState.errors.startDate?.message} />
            </div>
            <div
              aria-describedby={form.formState.errors.endDate ? 'lease-end-date-error' : undefined}
            >
              <Label htmlFor="endDate">End date (optional)</Label>
              <DatePicker
                id="endDate"
                label="End date"
                value={form.watch('endDate') ?? ''}
                onChange={(v) =>
                  form.setValue('endDate', v === '' ? null : v, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
                maxYear={new Date().getFullYear() + 30}
              />
              {/* The end>=start refine lands here via path: ['endDate']. */}
              <FieldError id="lease-end-date-error" message={form.formState.errors.endDate?.message} />
            </div>
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
