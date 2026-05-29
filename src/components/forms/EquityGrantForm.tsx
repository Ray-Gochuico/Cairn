import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EquityGrantSchema, type EquityGrant } from '@/types/schema';
import {
  applyVestingTemplate,
  VESTING_TEMPLATES,
  type VestingTemplateId,
  type VestingEntry,
} from '@/lib/vesting-templates';
import { computeFmvFromCompanyValuation } from '@/lib/equity-value';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// EquityGrantSchema declares the three calculator fields as
// `z.number().nullable().default(null)`. Zod treats them as optional on input
// (the default fills in undefined), which makes zodResolver derive a
// Resolver<Partial<...>> that won't unify with the strict
// EquityGrantFormValues type RHF expects. Stripping the .default()s here (the
// runtime defaults still come from DEFAULT_EQUITY_GRANT below) keeps input
// and output types aligned. Mirrors the pattern in AccountForm.tsx.
const EquityGrantFormSchema = EquityGrantSchema.omit({ id: true }).extend({
  companyValuation: z.number().nonnegative().nullable(),
  companyOutstandingShares: z.number().positive().nullable(),
  companyTotalDebt: z.number().nonnegative().nullable(),
});

export type EquityGrantFormValues = Omit<EquityGrant, 'id'>;

/**
 * Default form values. `ownerPersonId: 0` is intentionally invalid (the Zod
 * schema requires `int().positive()`) so the user must pick an owner before
 * the form will submit. We surface the error inline via the form-error panel.
 */
export const DEFAULT_EQUITY_GRANT: EquityGrantFormValues = {
  householdId: 1,
  ownerPersonId: 0,
  name: '',
  companyName: '',
  grantDate: '',
  strikePrice: 0,
  totalShares: 0,
  currentFmv: 0,
  vestingSchedule: [{ date: '', cumulativePct: 1.0 }],
  // Optional company-valuation calculator inputs. Default to null so the
  // calculator section starts collapsed in create mode (it auto-expands in
  // edit mode if any of these is non-null).
  companyValuation: null,
  companyOutstandingShares: null,
  companyTotalDebt: null,
};

export interface EquityGrantFormProps {
  initial: EquityGrantFormValues;
  persons: Array<{ id: number; name: string }>;
  onSubmit: (values: EquityGrantFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * Equity grant form with a row-editor vesting schedule.
 *
 * The vesting schedule is the only non-trivial part: we mirror the array
 * locally in `scheduleRows` so React can re-render the rows immediately on
 * edits, and `setValue('vestingSchedule', ...)` syncs RHF for submit/dirty
 * tracking. Selecting a template option calls `applyVestingTemplate` against
 * the current grant date and replaces the rows wholesale; selecting "Custom"
 * resets to a single blank row. We don't gate template application on the
 * grant date being set — if it's empty, the helper produces NaN dates, but
 * the user gets immediate visual feedback that the schedule is broken and
 * the schema rejects the submit. Returning silently if no grant date felt
 * worse: the dropdown appears to do nothing, leaving the user confused.
 */
export default function EquityGrantForm({
  initial,
  persons,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: EquityGrantFormProps) {
  const form = useForm<EquityGrantFormValues>({
    resolver: zodResolver(EquityGrantFormSchema),
    defaultValues: initial,
  });

  // Local mirror of vesting schedule for the row editor. RHF's `useFieldArray`
  // would also work, but a plain array + `setValue` is simpler given the
  // bulk replace ("apply template") interaction.
  const [scheduleRows, setScheduleRows] = useState<VestingEntry[]>(initial.vestingSchedule);

  // Re-sync if `initial` changes (edit mode -> different grant). Without this,
  // navigating between Edit different grants would show stale rows.
  useEffect(() => {
    setScheduleRows(initial.vestingSchedule);
  }, [initial]);

  const grantDate = form.watch('grantDate');

  // Live preview of the (val − debt) ÷ shares derivation. Watching the
  // three fields individually keeps the memoisation cheap; if any input
  // returns to '' the register's setValueAs collapses it to null and the
  // helper returns null, which we render as a placeholder dash.
  const watchedValuation = form.watch('companyValuation');
  const watchedShares = form.watch('companyOutstandingShares');
  const watchedDebt = form.watch('companyTotalDebt');
  const computedFmv = useMemo(
    () => computeFmvFromCompanyValuation(watchedValuation, watchedDebt, watchedShares),
    [watchedValuation, watchedDebt, watchedShares],
  );

  // Auto-expand the calculator section on first render if any of the three
  // inputs is populated (edit mode for grants that previously used the
  // calculator). The native <details> element manages its own open state
  // after that — we only set the initial `open` attribute.
  const calculatorOpenByDefault = useMemo(
    () =>
      initial.companyValuation != null ||
      initial.companyOutstandingShares != null ||
      initial.companyTotalDebt != null,
    [initial.companyValuation, initial.companyOutstandingShares, initial.companyTotalDebt],
  );

  function syncSchedule(next: VestingEntry[]) {
    setScheduleRows(next);
    form.setValue('vestingSchedule', next, { shouldDirty: true, shouldValidate: false });
  }

  function applyTemplate(id: VestingTemplateId | 'CUSTOM') {
    if (id === 'CUSTOM') {
      syncSchedule([{ date: '', cumulativePct: 1.0 }]);
      return;
    }
    if (!grantDate) {
      // No grant date yet — replace with a blank row instead of producing NaN
      // dates from `addMonths('', n)`. The user will see a single empty row
      // and can re-pick the template after setting the grant date.
      syncSchedule([{ date: '', cumulativePct: 1.0 }]);
      return;
    }
    syncSchedule(applyVestingTemplate(id, grantDate));
  }

  function updateRow(i: number, patch: Partial<VestingEntry>) {
    const next = scheduleRows.map((row, j) => (j === i ? { ...row, ...patch } : row));
    syncSchedule(next);
  }

  function removeRow(i: number) {
    syncSchedule(scheduleRows.filter((_, j) => j !== i));
  }

  function addRow() {
    syncSchedule([...scheduleRows, { date: '', cumulativePct: 1.0 }]);
  }

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equity grant details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-name">Name</Label>
              <Input
                id="grant-name"
                {...form.register('name')}
                placeholder="e.g., 2024 RSU grant"
              />
            </div>
            <div>
              <Label htmlFor="grant-company">Company</Label>
              <Input
                id="grant-company"
                {...form.register('companyName')}
                placeholder="e.g., Acme Corp"
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium mb-2">Owner</legend>
            <div className="flex flex-wrap gap-4">
              {persons.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  No persons yet — add a person first on the Persons tab.
                </span>
              ) : (
                persons.map((p) => (
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
                          shouldValidate: true,
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))
              )}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-date">Grant date</Label>
              <DatePicker
                id="grant-date"
                value={form.watch('grantDate')}
                onChange={(v) =>
                  form.setValue('grantDate', v, { shouldDirty: true, shouldTouch: true })
                }
              />
            </div>
            <div>
              <Label htmlFor="grant-strike">Strike price ($/share)</Label>
              <Input
                id="grant-strike"
                type="number"
                step="any"
                {...form.register('strikePrice', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-shares">Total shares</Label>
              <Input
                id="grant-shares"
                type="number"
                step="any"
                {...form.register('totalShares', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="grant-fmv">Current FMV ($/share)</Label>
              <Input
                id="grant-fmv"
                type="number"
                step="any"
                {...form.register('currentFmv', { valueAsNumber: true })}
              />
            </div>
          </div>

          <details open={calculatorOpenByDefault} className="border rounded-md p-3 bg-muted/30">
            <summary className="cursor-pointer text-sm font-medium select-none">
              Don't know the FMV? Estimate it from company valuation
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l">
              <p className="text-xs text-muted-foreground">
                Per-share value ={' '}
                <span className="font-mono">(company valuation − total debt) ÷ outstanding shares</span>.
              </p>
              <div>
                <Label htmlFor="company-valuation">Company valuation</Label>
                <Input
                  id="company-valuation"
                  type="number"
                  step="any"
                  placeholder="e.g., 100000000"
                  {...form.register('companyValuation', {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </div>
              <div>
                <Label htmlFor="company-total-debt">Total debt</Label>
                <Input
                  id="company-total-debt"
                  type="number"
                  step="any"
                  placeholder="e.g., 5000000"
                  {...form.register('companyTotalDebt', {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </div>
              <div>
                <Label htmlFor="company-outstanding-shares">Outstanding shares</Label>
                <Input
                  id="company-outstanding-shares"
                  type="number"
                  step="any"
                  placeholder="e.g., 10000000"
                  {...form.register('companyOutstandingShares', {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  Per-share value:{' '}
                  <span className="font-mono">
                    {computedFmv == null ? '—' : `$${computedFmv.value.toFixed(2)}`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={computedFmv == null}
                  onClick={() => {
                    if (computedFmv != null) {
                      form.setValue('currentFmv', computedFmv.value, {
                        shouldDirty: true,
                        shouldTouch: true,
                      });
                    }
                  }}
                >
                  Use this value
                </Button>
              </div>
              {computedFmv?.warning === 'OVER_LEVERAGED' && (
                <p className="text-xs text-muted-foreground">
                  Total debt exceeds company valuation — equity value would be ≤ 0. Using $0 as a floor.
                </p>
              )}
            </div>
          </details>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label htmlFor="vesting-template">Vesting schedule</Label>
              <select
                id="vesting-template"
                aria-label="Vesting template"
                className="text-sm border rounded px-2 py-1 bg-background"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    applyTemplate(e.target.value as VestingTemplateId | 'CUSTOM');
                  }
                }}
              >
                <option value="" disabled>
                  Apply template
                </option>
                {VESTING_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
                <option value="CUSTOM">Custom (start blank)</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Date</th>
                    <th className="py-1 pr-2 font-medium">Cumulative %</th>
                    <th className="py-1 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-2 align-top">
                        <DatePicker
                          id={`vesting-row-${i}-date`}
                          value={row.date}
                          onChange={(v) => updateRow(i, { date: v })}
                        />
                      </td>
                      <td className="py-1 pr-2 align-top">
                        <Input
                          type="number"
                          step="0.01"
                          value={Number.isFinite(row.cumulativePct) ? row.cumulativePct : 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            updateRow(i, {
                              cumulativePct: Number.isFinite(v) ? v : 0,
                            });
                          }}
                          aria-label={`Cumulative % for row ${i + 1}`}
                        />
                      </td>
                      <td className="py-1 align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRow(i)}
                          disabled={scheduleRows.length <= 1}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  Add row
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {fieldErrors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground">
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

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
        )}
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
