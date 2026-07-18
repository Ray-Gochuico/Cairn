import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LoanSchema, type Loan } from '@/types/schema';
import { MoneyInput } from '@/components/ui/money-input';
import { LoanType } from '@/types/enums';
import { amortize } from '@/lib/amortization';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';
import { fractionToPercent, percentToFraction } from '@/lib/percent-fields';

export type LoanFormValues = Omit<Loan, 'id'>;

// Form-shaped schema (Wave 11 T6): the STORAGE fraction interestRate (0..1) is
// swapped for a friendly percent-entry field interestRatePercent (0..100),
// translated at the load/submit boundary. Storage is always the fraction.
const LoanFormSchema = LoanSchema.omit({ id: true, interestRate: true }).extend({
  interestRatePercent: z.number().min(0).max(100),
});
type LoanFormShape = z.infer<typeof LoanFormSchema>;

const toFormShape = (v: LoanFormValues): LoanFormShape => {
  const { interestRate, ...rest } = v;
  return { ...rest, interestRatePercent: fractionToPercent(interestRate) };
};
const fromFormShape = (v: LoanFormShape): LoanFormValues => {
  const { interestRatePercent, ...rest } = v;
  return { ...rest, interestRate: percentToFraction(interestRatePercent) };
};

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
 * Standalone loan form. Used by the Loans page drawer and the SetupWizard Step 6
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
  const form = useForm<LoanFormShape>({
    resolver: zodResolver(LoanFormSchema),
    defaultValues: toFormShape(initial),
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
    // Wave-9 F4: the CONTRACT payment amortizes the ORIGINAL amount over the
    // full term. Using currentBalance over the full term understates every
    // seasoned loan's payment (the balance has less time left, not more).
    // Balance-only fallback covers rows where original wasn't provided.
    const principal = v.originalAmount > 0 ? v.originalAmount : v.currentBalance;
    const interestRate = percentToFraction(v.interestRatePercent);
    if (principal > 0 && interestRate >= 0 && v.termMonths > 0 && v.firstPaymentDate) {
      try {
        const result = amortize({
          principal,
          annualRatePct: interestRate,
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

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  return (
    <form
      onSubmit={form.handleSubmit((shape) => onValid(fromFormShape(shape)))}
      className="space-y-4"
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Loan details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            {/* Round-3 S6: the house trio — aria-invalid + aria-describedby
                + FieldError — on every field (AccountForm pattern). */}
            <Input
              id="name"
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
              aria-describedby={form.formState.errors.name ? 'loan-name-error' : undefined}
            />
            <FieldError id="loan-name-error" message={form.formState.errors.name?.message} />
          </div>

          <div>
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('type')}
              aria-invalid={form.formState.errors.type ? true : undefined}
              aria-describedby={form.formState.errors.type ? 'loan-type-error' : undefined}
            >
              {Object.entries(LOAN_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <FieldError id="loan-type-error" message={form.formState.errors.type?.message} />
          </div>

          {!onlyOnePerson && (
            <fieldset
              aria-describedby={form.formState.errors.obligorPersonId ? 'loan-obligor-error' : undefined}
            >
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
              <FieldError id="loan-obligor-error" message={form.formState.errors.obligorPersonId?.message} />
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="originalAmount">Original amount ($)</Label>
              <Controller
                control={form.control}
                name="originalAmount"
                render={({ field }) => (
                  <MoneyInput
                    id="originalAmount"
                    value={field.value ?? null}
                    onValueChange={(v) => field.onChange(v ?? 0)}
                    onBlur={() => {
                      field.onBlur();
                      tryAutoFillMonthlyPayment();
                    }}
                    aria-invalid={form.formState.errors.originalAmount ? true : undefined}
                    aria-describedby={form.formState.errors.originalAmount ? 'loan-original-amount-error' : undefined}
                  />
                )}
              />
              <FieldError id="loan-original-amount-error" message={form.formState.errors.originalAmount?.message} />
            </div>
            <div>
              <Label htmlFor="currentBalance">Current balance ($)</Label>
              <Controller
                control={form.control}
                name="currentBalance"
                render={({ field }) => (
                  <MoneyInput
                    id="currentBalance"
                    value={field.value ?? null}
                    onValueChange={(v) => field.onChange(v ?? 0)}
                    onBlur={() => {
                      field.onBlur();
                      tryAutoFillMonthlyPayment();
                    }}
                    aria-invalid={form.formState.errors.currentBalance ? true : undefined}
                    aria-describedby={form.formState.errors.currentBalance ? 'loan-current-balance-error' : undefined}
                  />
                )}
              />
              <FieldError id="loan-current-balance-error" message={form.formState.errors.currentBalance?.message} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="interestRatePercent">Interest rate (%)</Label>
              <div className="relative">
                <Input
                  id="interestRatePercent"
                  type="number"
                  step="0.01"
                  className="pr-7 text-right tabular-nums"
                  {...form.register('interestRatePercent', { valueAsNumber: true })}
                  onBlur={tryAutoFillMonthlyPayment}
                  aria-invalid={form.formState.errors.interestRatePercent ? true : undefined}
                  aria-describedby={form.formState.errors.interestRatePercent ? 'loan-interest-rate-error' : undefined}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
              <FieldError id="loan-interest-rate-error" message={form.formState.errors.interestRatePercent?.message} />
            </div>
            <div>
              <Label htmlFor="termMonths">Term (months)</Label>
              <Input
                id="termMonths"
                type="number"
                {...form.register('termMonths', { valueAsNumber: true })}
                onBlur={tryAutoFillMonthlyPayment}
                aria-invalid={form.formState.errors.termMonths ? true : undefined}
                aria-describedby={form.formState.errors.termMonths ? 'loan-term-months-error' : undefined}
              />
              <FieldError id="loan-term-months-error" message={form.formState.errors.termMonths?.message} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              aria-describedby={form.formState.errors.firstPaymentDate ? 'loan-first-payment-date-error' : undefined}
            >
              <Label htmlFor="firstPaymentDate">First payment date</Label>
              <DatePicker
                id="firstPaymentDate"
                label="First payment date"
                value={form.watch('firstPaymentDate')}
                onChange={(v) => {
                  form.setValue('firstPaymentDate', v, { shouldDirty: true, shouldTouch: true });
                  tryAutoFillMonthlyPayment();
                }}
              />
              <FieldError id="loan-first-payment-date-error" message={form.formState.errors.firstPaymentDate?.message} />
            </div>
            <div>
              <Label htmlFor="monthlyPayment">Monthly payment ($)</Label>
              <Controller
                control={form.control}
                name="monthlyPayment"
                render={({ field }) => (
                  <MoneyInput
                    id="monthlyPayment"
                    value={field.value ?? null}
                    onValueChange={(v) => {
                      setMonthlyPaymentEditedManually(true);
                      field.onChange(v ?? 0);
                    }}
                    onBlur={field.onBlur}
                    aria-invalid={form.formState.errors.monthlyPayment ? true : undefined}
                    aria-describedby={form.formState.errors.monthlyPayment ? 'loan-monthly-payment-error' : undefined}
                  />
                )}
              />
              <FieldError id="loan-monthly-payment-error" message={form.formState.errors.monthlyPayment?.message} />
            </div>
          </div>

          <div>
            <Label htmlFor="extraPaymentDefault">Extra payment default ($)</Label>
            <Controller
              control={form.control}
              name="extraPaymentDefault"
              render={({ field }) => (
                <MoneyInput
                  id="extraPaymentDefault"
                  value={field.value ?? null}
                  onValueChange={(v) => field.onChange(v ?? 0)}
                  onBlur={field.onBlur}
                  aria-invalid={form.formState.errors.extraPaymentDefault ? true : undefined}
                  aria-describedby={form.formState.errors.extraPaymentDefault ? 'loan-extra-payment-error' : undefined}
                />
              )}
            />
            <FieldError id="loan-extra-payment-error" message={form.formState.errors.extraPaymentDefault?.message} />
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
                aria-invalid={form.formState.errors.linkedPropertyId ? true : undefined}
                aria-describedby={form.formState.errors.linkedPropertyId ? 'loan-linked-property-error' : undefined}
              >
                <option value="">None</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <FieldError id="loan-linked-property-error" message={form.formState.errors.linkedPropertyId?.message} />
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
                aria-invalid={form.formState.errors.linkedVehicleId ? true : undefined}
                aria-describedby={form.formState.errors.linkedVehicleId ? 'loan-linked-vehicle-error' : undefined}
              >
                <option value="">None</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <FieldError id="loan-linked-vehicle-error" message={form.formState.errors.linkedVehicleId?.message} />
            </div>
          )}
        </CardContent>
      </Card>

            <FormErrorSummary
        fieldErrors={form.formState.errors}
        submitError={submitError}
        labels={{
          interestRatePercent: 'Interest rate',
          termMonths: 'Term (months)',
          firstPaymentDate: 'First payment date',
          originalAmount: 'Original amount',
          currentBalance: 'Current balance',
          monthlyPayment: 'Monthly payment',
          extraPaymentDefault: 'Extra payment default',
          obligorPersonId: 'Obligor',
          linkedPropertyId: 'Linked property',
          linkedVehicleId: 'Linked vehicle',
        }}
      />

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
