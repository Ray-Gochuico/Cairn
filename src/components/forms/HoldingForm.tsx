import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HoldingSchema, type Holding } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { humanizeZodMessage, useFormSubmit } from './form-errors';
import { Input } from '@/components/ui/input';

export type HoldingFormValues = Omit<Holding, 'id'>;

/**
 * Form-shape schema: targetAllocationPct is shown to the user as a whole
 * number percent (0..100) for ergonomics — DB stays at 0..1 fraction.
 * The form converts × 100 on display and ÷ 100 on submit.
 */
const HoldingRowFormSchema = HoldingSchema.omit({ id: true, targetAllocationPct: true }).extend({
  targetAllocationPctPercent: z.number().min(0).max(100).nullable(),
});
type HoldingRowFormValues = z.infer<typeof HoldingRowFormSchema>;

function nullableNumber(v: unknown) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isNaN(n) ? null : (n as number);
}

function toForm(values: HoldingFormValues): HoldingRowFormValues {
  const { targetAllocationPct, ...rest } = values;
  return {
    ...rest,
    targetAllocationPctPercent:
      targetAllocationPct === null ? null : targetAllocationPct * 100,
  };
}

function fromForm(values: HoldingRowFormValues): HoldingFormValues {
  const { targetAllocationPctPercent, ...rest } = values;
  return {
    ...rest,
    targetAllocationPct:
      targetAllocationPctPercent === null ? null : targetAllocationPctPercent / 100,
  };
}

export interface HoldingFormProps {
  initial: HoldingFormValues;
  onSave: (next: HoldingFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  saveLabel: string;
  /**
   * Optional async pre-save validator. Receives the about-to-be-persisted
   * Holding-shape values (targetAllocationPct already converted back to
   * 0..1). Return null to proceed; return an error message string to
   * block the save and surface the message inline.
   */
  onValidateSubmit?: (next: HoldingFormValues) => string | null;
  /**
   * If true, render a helper hint indicating that target-allocation sums
   * may exceed 100% (margin account).
   */
  allowMarginHint?: boolean;
}

/**
 * Standalone single-row holding form. Used by HoldingsTab and the
 * SetupWizard Step 5 onboarding flow. Renders as a 12-col grid row;
 * the caller supplies a column header row if it wants one.
 */
export default function HoldingForm({
  initial,
  onSave,
  onDelete,
  saveLabel,
  onValidateSubmit,
  allowMarginHint,
}: HoldingFormProps) {
  // Memoize on the primitive fields of `initial` so the `values` reference
  // only changes when the underlying data actually changes — parent renders
  // pass a fresh object literal each time, but RHF's `values` prop is
  // reference-compared. Per the conventions doc (Form sync with store):
  // `values` is the idiomatic way to keep RHF in lockstep with a store-
  // backed source and makes `isDirty` track "current vs. persisted",
  // which is what the Save button gates on.
  const memoValues = useMemo<HoldingRowFormValues>(
    () => toForm(initial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial.accountId, initial.ticker, initial.shareCount, initial.targetAllocationPct, initial.costBasis],
  );

  const form = useForm<HoldingRowFormValues>({
    resolver: zodResolver(HoldingRowFormSchema),
    defaultValues: memoValues,
    values: memoValues,
  });

  // W10 M44: a rejected onSave used to escape as an unhandled rejection.
  const { onValid, submitting, submitError } = useFormSubmit(
    async (values: HoldingRowFormValues) => {
      const dbValues = fromForm(values);
      if (onValidateSubmit) {
        const err = onValidateSubmit(dbValues);
        if (err) {
          form.setError('targetAllocationPctPercent', { type: 'manual', message: err });
          return;
        }
      }
      await onSave(dbValues);
      form.reset(values);
    },
  );

  return (
    <form
      onSubmit={form.handleSubmit(onValid)}
      className="grid grid-cols-12 gap-2 items-center py-2 border-b last:border-b-0"
    >
      <div className="col-span-2">
        <Input
          aria-label="ticker"
          placeholder="VTI"
          {...form.register('ticker', {
            setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
          })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="shares"
          type="number"
          step="any"
          placeholder="shares"
          {...form.register('shareCount', { valueAsNumber: true })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label={
            allowMarginHint
              ? 'target allocation (%) — margin allowed, sum can exceed 100%'
              : 'target allocation (%)'
          }
          type="number"
          step="1"
          placeholder="30"
          {...form.register('targetAllocationPctPercent', { setValueAs: nullableNumber })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="cost basis"
          type="number"
          step="any"
          placeholder="cost basis"
          {...form.register('costBasis', { setValueAs: nullableNumber })}
        />
      </div>
      <div className="col-span-4 flex justify-end gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={submitting || !form.formState.isDirty}
        >
          {saveLabel}
        </Button>
        {onDelete && (
          <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
      {(Object.keys(form.formState.errors).length > 0 || submitError) && (
        <div
          role="alert"
          className="col-span-12 mt-1 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive-soft-foreground"
        >
          {submitError ? (
            <div>Couldn’t save — {submitError}. Your changes are still on this row; try again.</div>
          ) : (
            // W10 M44: humanized messages (custom ones — like the >100% margin
            // guard — pass through), no raw RHF keys in a monospace pane.
            <ul className="list-disc pl-5">
              {Object.entries(form.formState.errors).map(([field, err]) => (
                <li key={field}>
                  {humanizeZodMessage((err as { message?: string })?.message)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
