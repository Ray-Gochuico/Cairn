import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ContributionSchema, type Contribution } from '@/types/schema';
import { ContributionSource } from '@/types/enums';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

export type ContributionFormValues = Omit<Contribution, 'id'>;

export const CONTRIBUTION_SOURCE_LABELS: Record<ContributionSource, string> = {
  [ContributionSource.PAYCHECK]: 'Paycheck',
  [ContributionSource.BONUS]: 'Bonus',
  [ContributionSource.EMPLOYER_MATCH]: 'Employer match',
  [ContributionSource.MANUAL]: 'Manual',
  [ContributionSource.ROLLOVER]: 'Rollover',
  [ContributionSource.ANNUAL_TOTAL]: 'Annual total',
};

export interface ContributionFormProps {
  initial: ContributionFormValues;
  accounts: Array<{ id: number; name: string }>;
  persons: Array<{ id: number; name: string }>;
  onSubmit: (values: ContributionFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Standalone contribution form (W14: extracted from ContributionsTab so the
 * Investments Manage surface can mount it in an EditDrawer). Presentational —
 * the caller owns persistence; a rejected save lands in the summary via
 * useFormSubmit (the Wave-10 form-errors adoption this inline form escaped).
 */
export default function ContributionForm({
  initial,
  accounts,
  persons,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: ContributionFormProps) {
  const form = useForm<ContributionFormValues>({
    resolver: zodResolver(ContributionSchema.omit({ id: true })),
    defaultValues: initial,
  });

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Contribution details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="accountId">Account</Label>
            <select
              id="accountId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('accountId', { valueAsNumber: true })}
              aria-invalid={form.formState.errors.accountId ? true : undefined}
              aria-describedby={form.formState.errors.accountId ? 'contribution-account-error' : undefined}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <FieldError id="contribution-account-error" message={form.formState.errors.accountId?.message} />
          </div>

          <div>
            <Label htmlFor="personId">Person</Label>
            <select
              id="personId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('personId', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
              aria-invalid={form.formState.errors.personId ? true : undefined}
              aria-describedby={form.formState.errors.personId ? 'contribution-person-error' : undefined}
            >
              <option value="">None</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <FieldError id="contribution-person-error" message={form.formState.errors.personId?.message} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              aria-describedby={form.formState.errors.date ? 'contribution-date-error' : undefined}
            >
              <Label htmlFor="date">Date</Label>
              <DatePicker
                id="date"
                label="Date"
                value={form.watch('date')}
                onChange={(v) =>
                  form.setValue('date', v, { shouldDirty: true, shouldTouch: true })
                }
              />
              <FieldError id="contribution-date-error" message={form.formState.errors.date?.message} />
            </div>
            <div>
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                type="number"
                step="any"
                {...form.register('amount', { valueAsNumber: true })}
                aria-invalid={form.formState.errors.amount ? true : undefined}
                aria-describedby={form.formState.errors.amount ? 'contribution-amount-error' : undefined}
              />
              <FieldError id="contribution-amount-error" message={form.formState.errors.amount?.message} />
            </div>
          </div>

          <div>
            <Label htmlFor="source">Source</Label>
            <select
              id="source"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('source')}
              aria-invalid={form.formState.errors.source ? true : undefined}
              aria-describedby={form.formState.errors.source ? 'contribution-source-error' : undefined}
            >
              {Object.entries(CONTRIBUTION_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <FieldError id="contribution-source-error" message={form.formState.errors.source?.message} />
          </div>
        </CardContent>
      </Card>

      <FormErrorSummary
        fieldErrors={form.formState.errors}
        submitError={submitError}
        labels={{
          accountId: 'Account',
          personId: 'Person',
          amount: 'Amount',
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
          disabled={submitting || !form.formState.isDirty}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
