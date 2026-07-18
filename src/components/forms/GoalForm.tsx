import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { GoalSchema, type Goal } from '@/types/schema';
import { GoalType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

export type GoalFormValues = Omit<Goal, 'id'>;

export const DEFAULT_GOAL: GoalFormValues = {
  householdId: 1,
  forPersonId: null,
  name: '',
  type: GoalType.GENERIC,
  targetAmount: 0,
  targetDate: '',
  linkedAccountIds: [],
};

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  [GoalType.RETIREMENT]: 'Retirement',
  [GoalType.DOWN_PAYMENT]: 'Down payment',
  [GoalType.DEBT_PAYOFF]: 'Debt payoff',
  [GoalType.EDUCATION]: 'Education',
  [GoalType.EMERGENCY_FUND]: 'Emergency fund',
  [GoalType.GENERIC]: 'Other',
};

export interface GoalFormProps {
  initial: GoalFormValues;
  persons: Array<{ id: number; name: string }>;
  accounts: Array<{ id: number; name: string; institution: string | null | undefined }>;
  onSubmit: (values: GoalFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * Standalone goal form used by the Goals page drawer. Mirrors LoanForm's structure:
 * native `<select>` for the GoalType (avoids Radix Select to keep tests simple),
 * radio group for `forPersonId` (Household / per-person), checkbox group for
 * `linkedAccountIds` (no accounts → no group rendered).
 */
export default function GoalForm({
  initial,
  persons,
  accounts,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: GoalFormProps) {
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(GoalSchema.omit({ id: true })),
    defaultValues: initial,
  });

  // form.watch returns a fresh array on every render; wrap in a Set so
  // membership checks are O(1) and the toggle below is straightforward.
  const linkedSet = new Set(form.watch('linkedAccountIds') ?? []);

  const toggleAccount = (id: number) => {
    const next = new Set(linkedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    form.setValue('linkedAccountIds', [...next], { shouldDirty: true, shouldTouch: true });
  };

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Goal details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              {/* Round-3 S6: the house trio — aria-invalid + aria-describedby
                  + FieldError — on every field (AccountForm pattern). */}
              <Input
                id="name"
                {...form.register('name')}
                placeholder="e.g., Emergency fund"
                aria-invalid={form.formState.errors.name ? true : undefined}
                aria-describedby={form.formState.errors.name ? 'goal-name-error' : undefined}
              />
              <FieldError id="goal-name-error" message={form.formState.errors.name?.message} />
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('type')}
                aria-invalid={form.formState.errors.type ? true : undefined}
                aria-describedby={form.formState.errors.type ? 'goal-type-error' : undefined}
              >
                {Object.entries(GOAL_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <FieldError id="goal-type-error" message={form.formState.errors.type?.message} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="targetAmount">Target amount ($)</Label>
              {/* Round-3 E6: house MoneyInput (LoanForm idiom); the S6 aria
                  wiring passes through MoneyInput's ...rest spread. */}
              <Controller
                control={form.control}
                name="targetAmount"
                render={({ field }) => (
                  <MoneyInput
                    id="targetAmount"
                    value={field.value ?? null}
                    onValueChange={(v) => field.onChange(v ?? 0)}
                    onBlur={field.onBlur}
                    aria-invalid={form.formState.errors.targetAmount ? true : undefined}
                    aria-describedby={form.formState.errors.targetAmount ? 'goal-target-amount-error' : undefined}
                  />
                )}
              />
              <FieldError id="goal-target-amount-error" message={form.formState.errors.targetAmount?.message} />
            </div>
            <div
              aria-describedby={form.formState.errors.targetDate ? 'goal-target-date-error' : undefined}
            >
              <Label htmlFor="targetDate">Target date</Label>
              <DatePicker
                id="targetDate"
                label="Target date"
                value={form.watch('targetDate')}
                onChange={(v) =>
                  form.setValue('targetDate', v, { shouldDirty: true, shouldTouch: true })
                }
                maxYear={new Date().getUTCFullYear() + 60}
              />
              <FieldError id="goal-target-date-error" message={form.formState.errors.targetDate?.message} />
            </div>
          </div>

          <fieldset
            aria-describedby={form.formState.errors.forPersonId ? 'goal-for-person-error' : undefined}
          >
            <legend className="text-sm font-medium mb-2">For</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="forPersonId"
                  value=""
                  checked={form.watch('forPersonId') === null}
                  onChange={() =>
                    form.setValue('forPersonId', null, { shouldDirty: true, shouldTouch: true })
                  }
                />
                Household
              </label>
              {persons.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="forPersonId"
                    value={String(p.id)}
                    checked={form.watch('forPersonId') === p.id}
                    onChange={() =>
                      form.setValue('forPersonId', p.id, { shouldDirty: true, shouldTouch: true })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <FieldError id="goal-for-person-error" message={form.formState.errors.forPersonId?.message} />
          </fieldset>

          {accounts.length > 0 && (
            <fieldset
              aria-describedby={form.formState.errors.linkedAccountIds ? 'goal-linked-accounts-error' : undefined}
            >
              <legend className="text-sm font-medium mb-2">Linked accounts</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={linkedSet.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                    />
                    <span>
                      {a.name}
                      {a.institution ? (
                        <span className="text-muted-foreground text-xs"> ({a.institution})</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <FieldError
                id="goal-linked-accounts-error"
                message={form.formState.errors.linkedAccountIds?.message}
              />
            </fieldset>
          )}
        </CardContent>
      </Card>

            <FormErrorSummary
        fieldErrors={form.formState.errors}
        submitError={submitError}
        labels={{
          forPersonId: 'For',
          linkedAccountIds: 'Linked accounts',
          targetAmount: 'Target amount',
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
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
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
