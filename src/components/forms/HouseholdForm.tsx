import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HouseholdSchema, type Household } from '@/types/schema';
import { fractionToPercent, percentToFraction } from '@/lib/percent-fields';
import { FilingStatus } from '@/types/enums';
import { prettifyCityCode, US_STATES } from '@/lib/jurisdiction-format';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

const CITY_TAX_YEAR = 2026;

// Roadmap rule-engine chart-answer columns are not managed by this form
// (set by roadmap decision nodes). Strip them so RHF + zodResolver see a
// stable, narrower schema. (Disclosure acceptance lives in
// disclosure_acceptances — never on the household — so there is nothing
// disclosure-related to strip here.)
export type HouseholdFormValues = Omit<
  Household,
  | 'id'
  | 'interestThresholdLowPct'
  | 'interestThresholdHighPct'
  | 'hasWrittenIps'
  | 'hasHsaQualifiedHdhp'
  | 'makesCharitableGifts'
  | 'upcomingLargePurchase'
  | 'upcomingPurchaseAmount'
  | 'upcomingPurchaseMonths'
>;

export const HOUSEHOLD_DEFAULT_VALUES: HouseholdFormValues = {
  name: null,
  filingStatus: FilingStatus.SINGLE,
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 0,
  withdrawalRate: 0.04,
  inflationAssumption: 0.024,
  growthScenarios: [
    { label: 'Conservative', rate: 0.05 },
    { label: 'Moderate', rate: 0.06 },
    { label: 'Optimistic', rate: 0.07 },
    { label: 'Bull', rate: 0.08 },
  ],
};

// Form-shaped schema (Wave 11 T6): the STORAGE fractions withdrawalRate /
// inflationAssumption (0..1) become friendly percent-entry fields (0..100),
// translated at the load/submit boundary. Storage stays the fraction.
const HouseholdFormSchema = HouseholdSchema.omit({
  id: true,
  interestThresholdLowPct: true,
  interestThresholdHighPct: true,
  hasWrittenIps: true,
  hasHsaQualifiedHdhp: true,
  makesCharitableGifts: true,
  upcomingLargePurchase: true,
  upcomingPurchaseAmount: true,
  upcomingPurchaseMonths: true,
  withdrawalRate: true,
  inflationAssumption: true,
}).extend({
  withdrawalRatePercent: z.number().min(0).max(100),
  inflationAssumptionPercent: z.number().min(0).max(100),
});
type HouseholdFormShape = z.infer<typeof HouseholdFormSchema>;

const toFormShape = (v: HouseholdFormValues): HouseholdFormShape => {
  const { withdrawalRate, inflationAssumption, ...rest } = v;
  return {
    ...rest,
    withdrawalRatePercent: fractionToPercent(withdrawalRate),
    inflationAssumptionPercent: fractionToPercent(inflationAssumption),
  };
};
const fromFormShape = (v: HouseholdFormShape): HouseholdFormValues => {
  const { withdrawalRatePercent, inflationAssumptionPercent, ...rest } = v;
  return {
    ...rest,
    withdrawalRate: percentToFraction(withdrawalRatePercent),
    inflationAssumption: percentToFraction(inflationAssumptionPercent),
  };
};

export interface HouseholdFormProps {
  /** Mapped from the store; when defined, RHF will reset to match it. */
  values: HouseholdFormValues | undefined;
  onSubmit: (values: HouseholdFormValues) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  /** Save button label. Defaults to "Save". */
  submitLabel?: string;
  /**
   * When true, the calm "Saved" fade-in flashes for 1.8s after a
   * successful submit. Used by the standing HouseholdTab where the
   * form stays mounted; the wizard step doesn't need this because
   * advancing the step is itself the success cue.
   */
  showSavedConfirmation?: boolean;
}

/**
 * Standalone household form. The Household row is a singleton seeded
 * by migration, so this is always an `update` — no create path. Used
 * by both HouseholdTab and SetupWizard Step 1; the caller wires the
 * store, this component owns RHF + validation + the field layout.
 */
export default function HouseholdForm({
  values,
  onSubmit,
  isLoading = false,
  error,
  submitLabel = 'Save',
  showSavedConfirmation = false,
}: HouseholdFormProps) {
  const formValues = useMemo(() => (values ? toFormShape(values) : undefined), [values]);
  const form = useForm<HouseholdFormShape>({
    resolver: zodResolver(HouseholdFormSchema),
    defaultValues: toFormShape(HOUSEHOLD_DEFAULT_VALUES),
    values: formValues,
  });

  // Load tax rules for 2026 on mount so city dropdown is populated.
  useEffect(() => {
    useTaxRulesStore.getState().loadYear(CITY_TAX_YEAR);
  }, []);

  const taxRulesItems = useTaxRulesStore((s) => s.items);
  const state = form.watch('state');

  // When state changes, clear city if its prefix no longer matches.
  useEffect(() => {
    const currentCity = form.watch('city');
    if (currentCity && !currentCity.startsWith(`${state}_`)) {
      form.setValue('city', null, { shouldDirty: true });
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter to CITY rules scoped to the current state (SINGLE only to avoid duplicates).
  const cityRules = taxRulesItems.filter(
    (r) =>
      r.jurisdictionType === 'CITY' &&
      r.filingStatus === 'SINGLE' &&
      r.jurisdictionCode.startsWith(`${state}_`),
  );

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  // W10 M44: useFormSubmit catches a rejected save into submitError; the
  // justSaved confirmation only fires when the save resolved.
  const { onValid, submitError } = useFormSubmit(async (next: HouseholdFormValues) => {
    await onSubmit(next);

    if (showSavedConfirmation) {
      setJustSaved(true);
    }
  });

  const dirty = form.formState.isDirty;

  return (
    <form
      onSubmit={form.handleSubmit((shape) => onValid(fromFormShape(shape)))}
      className="space-y-4"
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Identity &amp; tax</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Household name (optional)</Label>
            {/* Round-3 S6: the house trio — aria-invalid + aria-describedby
                + FieldError — on every field (AccountForm pattern). */}
            <Input
              id="name"
              {...form.register('name', { setValueAs: (v) => (v === '' ? null : v) })}
              aria-invalid={form.formState.errors.name ? true : undefined}
              aria-describedby={form.formState.errors.name ? 'household-name-error' : undefined}
            />
            <FieldError id="household-name-error" message={form.formState.errors.name?.message} />
          </div>

          <div>
            <Label htmlFor="filingStatus">Filing status</Label>
            <Select
              value={form.watch('filingStatus')}
              onValueChange={(v) =>
                form.setValue('filingStatus', v as FilingStatus, {
                  shouldDirty: true,
                  shouldTouch: true,
                })
              }
            >
              <SelectTrigger
                id="filingStatus"
                aria-invalid={form.formState.errors.filingStatus ? true : undefined}
                aria-describedby={form.formState.errors.filingStatus ? 'household-filing-status-error' : undefined}
              ><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={FilingStatus.SINGLE}>Single</SelectItem>
                <SelectItem value={FilingStatus.MFJ}>Married Filing Jointly</SelectItem>
                <SelectItem value={FilingStatus.MFS}>Married Filing Separately</SelectItem>
                <SelectItem value={FilingStatus.HOH}>Head of Household</SelectItem>
              </SelectContent>
            </Select>
            <FieldError id="household-filing-status-error" message={form.formState.errors.filingStatus?.message} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                maxLength={2}
                list="us-states"
                {...form.register('state', {
                  setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                })}
                placeholder="CA"
                aria-invalid={form.formState.errors.state ? true : undefined}
                aria-describedby={form.formState.errors.state ? 'household-state-error' : undefined}
              />
              <FieldError id="household-state-error" message={form.formState.errors.state?.message} />
              <datalist id="us-states">
                {US_STATES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="city">City (only if it has local income tax)</Label>
              <select
                id="city"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.watch('city') ?? ''}
                onChange={(e) =>
                  form.setValue('city', e.target.value === '' ? null : e.target.value, {
                    shouldDirty: true,
                  })
                }
              >
                <option value="">(No local tax)</option>
                {cityRules.map((r) => (
                  <option key={r.jurisdictionCode} value={r.jurisdictionCode}>
                    {prettifyCityCode(r.jurisdictionCode)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Assumptions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="monthlyExpenseBaseline">Monthly expense baseline ($)</Label>
            <Input
              id="monthlyExpenseBaseline"
              type="number"
              step="any"
              {...form.register('monthlyExpenseBaseline', { valueAsNumber: true })}
              aria-invalid={form.formState.errors.monthlyExpenseBaseline ? true : undefined}
              aria-describedby={form.formState.errors.monthlyExpenseBaseline ? 'household-expense-baseline-error' : undefined}
            />
            <FieldError id="household-expense-baseline-error" message={form.formState.errors.monthlyExpenseBaseline?.message} />
          </div>

          {/*
            Long labels like "Withdrawal rate (e.g. 0.04 = 4% rule)" previously
            stacked one-word-per-line at narrow Inputs widths (sidebar +
            sub-nav consume ~250 px). Bumped to md:grid-cols-2 so each cell
            keeps the label readable until the viewport has real room for two
            columns, and added break-words so a forced-narrow viewport still
            wraps gracefully instead of overflowing.
          */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="min-w-0">
              <Label htmlFor="withdrawalRatePercent" className="break-words">
                Withdrawal rate (%)
              </Label>
              <div className="relative">
                <Input
                  id="withdrawalRatePercent"
                  type="number"
                  step="0.1"
                  className="pr-7 text-right tabular-nums"
                  {...form.register('withdrawalRatePercent', { valueAsNumber: true })}
                  aria-invalid={form.formState.errors.withdrawalRatePercent ? true : undefined}
                  aria-describedby={form.formState.errors.withdrawalRatePercent ? 'household-withdrawal-rate-error' : undefined}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
              <FieldError id="household-withdrawal-rate-error" message={form.formState.errors.withdrawalRatePercent?.message} />
              <p className="mt-1 text-xs text-muted-foreground">4 = the classic 4% rule</p>
            </div>
            <div className="min-w-0">
              <Label htmlFor="inflationAssumptionPercent" className="break-words">
                Inflation assumption (%)
              </Label>
              <div className="relative">
                <Input
                  id="inflationAssumptionPercent"
                  type="number"
                  step="0.1"
                  className="pr-7 text-right tabular-nums"
                  {...form.register('inflationAssumptionPercent', { valueAsNumber: true })}
                  aria-invalid={form.formState.errors.inflationAssumptionPercent ? true : undefined}
                  aria-describedby={form.formState.errors.inflationAssumptionPercent ? 'household-inflation-error' : undefined}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
              <FieldError id="household-inflation-error" message={form.formState.errors.inflationAssumptionPercent?.message} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* W10 M44: humanized field summary + submit/store failures in one pane.
          Round-3 S6: labels map the percent-suffixed identifiers back to
          their visible labels ("Withdrawal rate", not "Withdrawal rate percent"). */}
      <FormErrorSummary
        fieldErrors={form.formState.errors}
        submitError={submitError ?? error}
        labels={{
          withdrawalRatePercent: 'Withdrawal rate',
          inflationAssumptionPercent: 'Inflation assumption',
          monthlyExpenseBaseline: 'Monthly expenses',
          filingStatus: 'Filing status',
        }}
      />

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: isLoading || justSaved ? 1 : 0 }}
          aria-live="polite"
        >
          {isLoading ? 'Saving…' : justSaved ? 'Saved' : ''}
        </span>
        <Button type="submit" disabled={isLoading || !dirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
