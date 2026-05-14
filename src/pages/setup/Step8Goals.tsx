import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { GoalSchema, type Goal } from '@/types/schema';
import { GoalType } from '@/types/enums';
import { useGoalsStore } from '@/stores/goals-store';
import { useHouseholdStore } from '@/stores/household-store';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GOAL_TYPE_LABELS } from '@/components/forms/GoalForm';

interface Props {
  onComplete: () => void;
}

type GoalFormValues = Omit<Goal, 'id'>;

/**
 * Setup wizard Step 9 — Goals creation (final step).
 *
 * The user can:
 *   - Skip → onComplete() fires immediately, no goal saved.
 *   - Save with a non-empty name → goal is persisted via useGoalsStore.create
 *     and onComplete() fires after the write resolves.
 *   - Save with a blank name → treated as Skip (no error, no save). This
 *     keeps the "I clicked the wrong button" path graceful instead of
 *     triggering a Zod validation error on a step that's labelled optional.
 *
 * Goals are linked to a household; the wizard runs after Step 1 has seeded
 * the household, so household.id is normally present. We default to 1 as a
 * fallback because the migration always creates row id=1 — this matches
 * GoalForm's `DEFAULT_GOAL` constant.
 */
export default function Step8Goals({ onComplete }: Props) {
  const household = useHouseholdStore((s) => s.household);
  const create = useGoalsStore((s) => s.create);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(GoalSchema.omit({ id: true })),
    defaultValues: {
      householdId: household?.id ?? 1,
      forPersonId: null,
      name: '',
      type: GoalType.GENERIC,
      targetAmount: 0,
      targetDate: '',
      linkedAccountIds: [],
    },
  });

  const handleSkip = () => onComplete();

  // We intercept submit before handing off to react-hook-form: if the name is
  // blank, the step is "optional" — treat Save as Skip and finish without
  // running Zod validation (which would otherwise complain about name/date
  // being required and stall the wizard). Only when the user actually typed
  // a name do we delegate to handleSubmit so the rest of the schema applies.
  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = form.getValues('name');
    if (!name || name.trim().length === 0) {
      onComplete();
      return;
    }
    void form.handleSubmit(async (values) => {
      try {
        setSubmitting(true);
        await create(values);
        onComplete();
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h2 className="text-2xl font-semibold">Add your first goal (optional)</h2>
      <p className="text-sm text-muted-foreground">
        Goals help you track whether you&apos;re on pace for big milestones. You can
        add or edit goals later from the Inputs page.
      </p>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="goal-name">Goal name</Label>
            <Input
              id="goal-name"
              {...form.register('name')}
              placeholder="e.g., Emergency fund"
            />
          </div>
          <div>
            <Label htmlFor="goal-type">Type</Label>
            <select
              id="goal-type"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('type')}
            >
              {Object.entries(GOAL_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="goal-amount">Target amount</Label>
            <Input
              id="goal-amount"
              type="number"
              step="any"
              {...form.register('targetAmount', { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label htmlFor="goal-date">Target date</Label>
            <DatePicker
              id="goal-date"
              maxYear={new Date().getFullYear() + 60}
              value={form.watch('targetDate')}
              onChange={(v) =>
                form.setValue('targetDate', v, { shouldDirty: true, shouldTouch: true })
              }
            />
          </div>
        </div>
        {fieldErrors.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="font-medium mb-1">Fix these before saving:</div>
            <ul className="list-disc pl-5">
              {fieldErrors.map((e) => (
                <li key={e.field}>
                  <span className="font-mono">{e.field}</span>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleSkip} disabled={submitting}>
            Skip
          </Button>
          <Button type="submit" disabled={submitting}>
            Save goal &amp; finish
          </Button>
        </div>
      </form>
    </div>
  );
}
