import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoanSchema, type Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';
import { amortize } from '@/lib/amortization';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type LoanFormValues = Omit<Loan, 'id'>;

export const DEFAULT_LOAN: LoanFormValues = {
  householdId: 1,
  obligorPersonId: null,
  name: '',
  type: LoanType.MORTGAGE,
  originalAmount: 0,
  currentBalance: 0,
  interestRate: 0,
  termMonths: 360,
  firstPaymentDate: '',
  monthlyPayment: 0,
  extraPaymentDefault: 0,
  linkedPropertyId: null,
  linkedVehicleId: null,
};

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  [LoanType.MORTGAGE]: 'Mortgage',
  [LoanType.AUTO]: 'Auto',
  [LoanType.STUDENT]: 'Student',
  [LoanType.PERSONAL]: 'Personal',
  [LoanType.CREDIT_CARD]: 'Credit Card',
  [LoanType.OTHER]: 'Other',
};

export interface LoanFormProps {
  initial: LoanFormValues;
  persons: Array<{ id: number; name: string }>;
  properties: Array<{ id: number; name: string }>;
  vehicles: Array<{ id: number; name: string }>;
  /** True if `initial.monthlyPayment` was a meaningful user value (edit mode) — prevents auto-fill from clobbering it. */
  initialMonthlyPaymentIsUserSet: boolean;
  onSubmit: (values: LoanFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Standalone loan form. Used by both LoansTab and the SetupWizard Step 6
 * onboarding flow. Owns the amortization-driven auto-fill of monthlyPayment
 * (only until the user explicitly edits the field) and the type-dependent
 * linkedPropertyId / linkedVehicleId pickers.
 */
export default function LoanForm({
  initial,
  persons,
  properties,
  vehicles,
  initialMonthlyPaymentIsUserSet,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: LoanFormProps) {
  const form = useForm<LoanFormValues>({
    resolver: zodResolver(LoanSchema.omit({ id: true })),
    defaultValues: initial,
  });

  const [monthlyPaymentEditedManually, setMonthlyPaymentEditedManually] = useState(
    initialMonthlyPaymentIsUserSet,
  );

  const currentType = form.watch('type');
  const isMortgage = currentType === LoanType.MORTGAGE;
  const isAuto = currentType === LoanType.AUTO;
  const onlyOnePerson = persons.length === 1;
  const noPersons = persons.length === 0;

  // For single-person households, force obligor to that person so the schema validates.
  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('obligorPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  // When type changes off MORTGAGE/AUTO, null out the conditionally-rendered FK so it
  // doesn't leak a stale value into a write.
  useEffect(() => {
    if (!isMortgage) {
      form.setValue('linkedPropertyId', null, { shouldDirty: false });
    }
    if (!isAuto) {
      form.setValue('linkedVehicleId', null, { shouldDirty: false });
    }
  }, [isMortgage, isAuto, form]);

  const tryAutoFillMonthlyPayment = () => {
    if (monthlyPaymentEditedManually) return;
    const v = form.getValues();
    const principal = v.currentBalance > 0 ? v.currentBalance : v.originalAmount;
    if (principal > 0 && v.interestRate >= 0 && v.termMonths > 0 && v.firstPaymentDate) {
      try {
        const result = amortize({
          principal,
          annualRatePct: v.interestRate,
          termMonths: v.termMonths,
          firstPaymentDate: v.firstPaymentDate,
          extraPayment: 0,
        });
        form.setValue('monthlyPayment', result.monthlyPayment, { shouldDirty: false });
      } catch {
        // Invalid input — leave field as-is.
      }
    }
  };

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
        <CardHeader><CardTitle className="text-base">Loan details</CardTitle></CardHeader>
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
              {Object.entries(LOAN_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {!onlyOnePerson && (
            <fieldset>
              <legend className="text-sm font-medium mb-2">Obligor</legend>
              <div className="flex flex-wrap gap-4">
                {persons.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="obligorPersonId"
                      value={String(p.id)}
                      checked={form.watch('obligorPersonId') === p.id}
                      onChange={() =>
                        form.setValue('obligorPersonId', p.id, { shouldDirty: true, shouldTouch: true })
                      }
                    />
                    {p.name}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="obligorPersonId"
                    value=""
                    checked={form.watch('obligorPersonId') === null}
                    onChange={() =>
                      form.setValue('obligorPersonId', null, { shouldDirty: true, shouldTouch: true })
                    }
                  />
                  Joint
                </label>
              </div>
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="originalAmount">Original amount ($)</Label>
              <Input
                id="originalAmount"
                type="number"
                step="any"
                {...form.register('originalAmount', { valueAsNumber: true })}
                onBlur={tryAutoFillMonthlyPayment}
              />
            </div>
            <div>
              <Label htmlFor="currentBalance">Current balance ($)</Label>
              <Input
                id="currentBalance"
                type="number"
                step="any"
                {...form.register('currentBalance', { valueAsNumber: true })}
                onBlur={tryAutoFillMonthlyPayment}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="interestRate">Interest rate (e.g. 0.06 = 6%)</Label>
              <Input
                id="interestRate"
                type="number"
                step="0.001"
                {...form.register('interestRate', { valueAsNumber: true })}
                onBlur={tryAutoFillMonthlyPayment}
              />
            </div>
            <div>
              <Label htmlFor="termMonths">Term (months)</Label>
              <Input
                id="termMonths"
                type="number"
                {...form.register('termMonths', { valueAsNumber: true })}
                onBlur={tryAutoFillMonthlyPayment}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstPaymentDate">First payment date</Label>
              <DatePicker
                id="firstPaymentDate"
                value={form.watch('firstPaymentDate')}
                onChange={(v) => {
                  form.setValue('firstPaymentDate', v, { shouldDirty: true, shouldTouch: true });
                  tryAutoFillMonthlyPayment();
                }}
              />
            </div>
            <div>
              <Label htmlFor="monthlyPayment">Monthly payment ($)</Label>
              <Input
                id="monthlyPayment"
                type="number"
                step="any"
                {...form.register('monthlyPayment', {
                  valueAsNumber: true,
                  onChange: () => setMonthlyPaymentEditedManually(true),
                })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="extraPaymentDefault">Extra payment default ($)</Label>
            <Input
              id="extraPaymentDefault"
              type="number"
              step="any"
              {...form.register('extraPaymentDefault', { valueAsNumber: true })}
            />
          </div>

          {isMortgage && (
            <div>
              <Label htmlFor="linkedPropertyId">Linked property</Label>
              <select
                id="linkedPropertyId"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('linkedPropertyId', {
                  setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
                })}
              >
                <option value="">None</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {isAuto && (
            <div>
              <Label htmlFor="linkedVehicleId">Linked vehicle</Label>
              <select
                id="linkedVehicleId"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('linkedVehicleId', {
                  setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
                })}
              >
                <option value="">None</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
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
