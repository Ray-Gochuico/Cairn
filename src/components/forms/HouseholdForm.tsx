import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { HouseholdSchema, type Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';
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

const CITY_TAX_YEAR = 2026;

/** Convert a jurisdiction code like NY_NYC → "NYC", MI_DETROIT → "Detroit". Keeps short
 * all-caps abbreviations (length ≤ 3 letters, all uppercase) as-is to avoid mangling NYC, DC, etc. */
function prettifyCityCode(code: string): string {
  const parts = code.split('_');
  // First part is the state prefix; drop it.
  const rest = parts.slice(1);
  return rest
    .map((p) => {
      if (p.length <= 3 && /^[A-Z]+$/.test(p)) return p;
      return p.charAt(0) + p.slice(1).toLowerCase();
    })
    .join(' ');
}

// Disclosure cache columns + roadmap rule-engine chart-answer columns
// are not managed by this form (set by disclosure modals / roadmap
// decision nodes). Strip them so RHF + zodResolver see a stable,
// narrower schema.
export type HouseholdFormValues = Omit<
  Household,
  | 'id'
  | 'disclaimerAcceptedAt'
  | 'disclaimerVersionAccepted'
  | 'roadmapDisclaimerAcceptedAt'
  | 'roadmapDisclaimerVersionAccepted'
  | 'interestThresholdLowPct'
  | 'interestThresholdHighPct'
  | 'hasWrittenIps'
  | 'hasHsaQualifiedHdhp'
  | 'makesCharitableGifts'
  | 'upcomingLargePurchase'
  | 'upcomingPurchaseAmount'
  | 'upcomingPurchaseMonths'
>;

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

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
  const form = useForm<HouseholdFormValues>({
    resolver: zodResolver(
      HouseholdSchema.omit({
        id: true,
        disclaimerAcceptedAt: true,
        disclaimerVersionAccepted: true,
        roadmapDisclaimerAcceptedAt: true,
        roadmapDisclaimerVersionAccepted: true,
        interestThresholdLowPct: true,
        interestThresholdHighPct: true,
        hasWrittenIps: true,
        hasHsaQualifiedHdhp: true,
        makesCharitableGifts: true,
        upcomingLargePurchase: true,
        upcomingPurchaseAmount: true,
        upcomingPurchaseMonths: true,
      }),
    ),
    defaultValues: HOUSEHOLD_DEFAULT_VALUES,
    values,
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

  const handleSubmit = async (next: HouseholdFormValues) => {
    try {
      await onSubmit(next);
      if (showSavedConfirmation) {
        setJustSaved(true);
      }
    } catch {
      // Errors propagate via `error` prop from the store; nothing else to do.
    }
  };

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  const dirty = form.formState.isDirty;

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Identity &amp; tax</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Household name (optional)</Label>
            <Input
              id="name"
              {...form.register('name', { setValueAs: (v) => (v === '' ? null : v) })}
            />
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
              <SelectTrigger id="filingStatus"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={FilingStatus.SINGLE}>Single</SelectItem>
                <SelectItem value={FilingStatus.MFJ}>Married Filing Jointly</SelectItem>
                <SelectItem value={FilingStatus.MFS}>Married Filing Separately</SelectItem>
                <SelectItem value={FilingStatus.HOH}>Head of Household</SelectItem>
              </SelectContent>
            </Select>
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
              />
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
            />
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
              <Label htmlFor="withdrawalRate" className="break-words">
                Withdrawal rate (e.g. 0.04 = 4% rule)
              </Label>
              <Input
                id="withdrawalRate"
                type="number"
                step="0.001"
                {...form.register('withdrawalRate', { valueAsNumber: true })}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="inflationAssumption" className="break-words">
                Inflation assumption
              </Label>
              <Input
                id="inflationAssumption"
                type="number"
                step="0.001"
                {...form.register('inflationAssumption', { valueAsNumber: true })}
              />
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

      {error && (
        <div className="text-sm text-destructive-soft-foreground">{error}</div>
      )}

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
