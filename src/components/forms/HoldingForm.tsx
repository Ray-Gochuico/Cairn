import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HoldingSchema, type Holding } from '@/types/schema';
import { Button } from '@/components/ui/button';
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
  const form = useForm<HoldingRowFormValues>({
    resolver: zodResolver(HoldingRowFormSchema),
    defaultValues: toForm(initial),
  });

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
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
      })}
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
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          {saveLabel}
        </Button>
        {onDelete && (
          <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
      {Object.keys(form.formState.errors).length > 0 && (
        <div
          role="alert"
          className="col-span-12 mt-1 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
        >
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
    </form>
  );
}
