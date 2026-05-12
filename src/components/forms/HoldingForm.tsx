import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { HoldingSchema, type Holding } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type HoldingFormValues = Omit<Holding, 'id'>;

const HoldingRowSchema = HoldingSchema.omit({ id: true });

function nullableNumber(v: unknown) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isNaN(n) ? null : (n as number);
}

export interface HoldingFormProps {
  initial: HoldingFormValues;
  onSave: (next: HoldingFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  saveLabel: string;
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
}: HoldingFormProps) {
  const form = useForm<HoldingFormValues>({
    resolver: zodResolver(HoldingRowSchema),
    defaultValues: initial,
  });

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await onSave(values);
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
          aria-label="target allocation"
          type="number"
          step="0.01"
          placeholder="0.40"
          {...form.register('targetAllocationPct', { setValueAs: nullableNumber })}
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
    </form>
  );
}
