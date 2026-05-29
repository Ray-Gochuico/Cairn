import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  HousingPaymentBaseSchema,
  type HousingPayment,
} from '@/types/schema';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type HousingPaymentFormValues = Omit<HousingPayment, 'id'>;

// Zod 4 disallows .omit() on a refined object schema. Strip the id first,
// then re-apply the end>=start cross-field refinement for the form resolver.
const HousingPaymentFormSchema = HousingPaymentBaseSchema
  .omit({ id: true })
  .refine((v) => v.endDate == null || v.endDate >= v.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export const DEFAULT_HOUSING_PAYMENT: HousingPaymentFormValues = {
  householdId: 1,
  ownerPersonId: null,
  name: '',
  monthlyAmount: 0,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: null,
};

export interface HousingPaymentFormProps {
  initial: HousingPaymentFormValues;
  persons: Array<{ id: number; name: string }>;
  onSubmit: (values: HousingPaymentFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Canonical rent / housing-payment form. Shared by PropertiesTab's
 * sibling input tab (HousingPaymentsTab) and the Setup Wizard.
 */
export default function HousingPaymentForm({
  initial,
  persons,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: HousingPaymentFormProps) {
  const form = useForm<HousingPaymentFormValues>({
    resolver: zodResolver(HousingPaymentFormSchema),
    defaultValues: initial,
  });

  const onlyOnePerson = persons.length === 1;

  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('ownerPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rent / housing payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Label</Label>
            <Input id="name" placeholder="e.g. Apt rent" {...form.register('name')} />
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
            />
          </div>

          {!onlyOnePerson && persons.length > 0 && (
            <fieldset>
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
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="startDate">Start date</Label>
              <DatePicker
                id="startDate"
                value={form.watch('startDate')}
                onChange={(v) =>
                  form.setValue('startDate', v, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="endDate">End date (optional)</Label>
              <DatePicker
                id="endDate"
                value={form.watch('endDate') ?? ''}
                onChange={(v) =>
                  form.setValue('endDate', v === '' ? null : v, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
                maxYear={new Date().getFullYear() + 30}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {Object.keys(form.formState.errors).length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground">
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
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
