import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react'; // shared back-nav icon (W2/BT-6)
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import {
  computeTotalTax,
  computeFicaBreakdown,
  computePretaxDeductions,
} from '@/lib/tax';
// Finance #2: health-FSA cap, sourced from the same 2026 constants module the
// tax engine uses for the 401(k)/HSA/SS caps. NOTE: CONTRIBUTION_LIMITS_2026
// must gain a HEALTH_FSA member (see the FLAG in Task 6, Step 1).
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { computeTakeHome } from '@/lib/paycheck-takehome';
import { formatCurrency } from '@/lib/format';
import {
  PAYCHECK_PERIODS,
  periodsPerYear,
  type PaycheckPeriod,
} from '@/lib/paycheck-periods';
// Shared tax scaffolding (year-resolution + resolvedYear-aware `lookup`),
// owned by Calculators Wave 0b — see the v1.x coordination contract §1/§2.
// Replaces the inline seededYears/getCurrentTaxYear/loadAvailableYears + the
// hand-rolled `lookup` closure this page used to own.
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { prettifyCityCode, US_STATES } from '@/lib/jurisdiction-format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import DonutChartCard, { type DonutSlice } from '@/components/charts/DonutChartCard';
import PaycheckBreakdownRow from './PaycheckBreakdownRow';
import type { FilingStatus } from '@/types/enums';

// Swatch palette for the breakdown rows + donut. The slate deduction-ramp
// (gross→federal→ss→medicare) stays raw hex — it's a legitimate sequential
// narrative, not a duplicated token. The three SEMANTIC rows (post-tax/extra/
// take-home) resolve to the success/warning/destructive tokens via `hsl(var(…))`
// so they theme-track instead of duplicating those tokens as frozen hex (Design
// F1). The take-home wedge is the green hero.
const COLORS = {
  gross: '#94a3b8',
  // Mid-slate, not near-black: '#1e293b' (slate-800) is effectively invisible
  // on a slate-950 dark card. '#64748b'-ish reads on both themes.
  federal: '#475569',
  ss: '#64748b',
  medicare: '#94a3b8',
  state: '#0ea5e9',
  city: '#7dd3fc',
  pretax: '#86efac',
  // Theme-tracked (Design F1): match the --warning/--destructive/--success
  // tokens these rows already mean, rather than freezing them as hex.
  posttax: 'hsl(var(--warning))',
  extra: 'hsl(var(--destructive))',
  takehome: 'hsl(var(--success))',
} as const;

// RHF form shape. A Zod schema gives the resolver something to validate and
// keeps the field set in one place. The numeric inputs are registered with
// `valueAsNumber: true`, so RHF hands the resolver `number`s directly — we use
// plain `z.number()` (NOT `z.coerce.number()`, whose Zod-4 input type is
// `unknown` and would make the resolver's input type mismatch `FormValues`);
// every numeric field is still clamped to non-negative where it matters, and
// the runtime `num()` guard below maps a transient NaN -> 0. This matches the
// rest of the app's forms (PersonForm/GoalForm/etc.), none of which use
// `z.coerce` either.
const PaycheckFormSchema = z.object({
  grossAnnual: z.number().nonnegative(),
  // A PaycheckPeriod id; not user-free-text. Constrained to the literal union
  // (not a bare z.string()) so the resolver's inferred type matches FormValues
  // exactly under @hookform/resolvers v5 — a bare string would leave the field
  // as `string`, which isn't assignable to the `PaycheckPeriod`/`FilingStatus`
  // FormValues fields the tax functions consume.
  payFrequency: z.enum([
    'ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY',
    'SEMI_MONTHLY', 'BI_WEEKLY', 'WEEKLY', 'DAILY',
  ]),
  filingStatus: z.enum(['SINGLE', 'MFJ', 'MFS', 'HOH']), // a FilingStatus id
  dependents: z.number().int().min(0),
  state: z.string().max(2),
  city: z.string().nullable(),
  pretax401kPct: z.number().min(0), // whole percent, e.g. 5 = 5%
  healthMonthly: z.number().min(0),
  hsaMonthly: z.number().min(0),
  fsaMonthly: z.number().min(0),
  roth401kPct: z.number().min(0),   // whole percent
  otherPostTaxMonthly: z.number().min(0),
  extraFederalPerPaycheck: z.number().min(0),
});

// The resolved (post-coercion) shape RHF holds and the computation reads.
type FormValues = {
  grossAnnual: number;
  payFrequency: PaycheckPeriod;
  filingStatus: FilingStatus;
  dependents: number;
  state: string;
  city: string | null;
  pretax401kPct: number;
  healthMonthly: number;
  hsaMonthly: number;
  fsaMonthly: number;
  roth401kPct: number;
  otherPostTaxMonthly: number;
  extraFederalPerPaycheck: number;
};

// Static fallback for the very first render before any store has hydrated.
// Once the profile loads, the memoized `values` (below) supersedes this via
// RHF's `values` prop — WITHOUT clobbering fields the user has already edited.
const FORM_FALLBACK: FormValues = {
  grossAnnual: 0,
  payFrequency: 'ANNUAL',
  filingStatus: 'SINGLE' as FilingStatus,
  dependents: 0,
  state: 'CA',
  city: null,
  pretax401kPct: 0,
  healthMonthly: 0,
  hsaMonthly: 0,
  fsaMonthly: 0,
  roth401kPct: 0,
  otherPostTaxMonthly: 0,
  extraFederalPerPaycheck: 0,
};

export default function PaycheckCalculator() {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);

  // Shared W-2 tax scaffolding from Calculators Wave 0b (contract §1/§2): runs the
  // one-time `loadAvailableYears` bootstrap, resolves the seeded tax year, and
  // exposes a `resolvedYear`-aware raw `lookup(jt, code, fs)`. We use the RAW
  // `lookup` + `resolvedYear` here (NOT `tax.federal`/`tax.state`/`tax.city`),
  // because this full-page form lets the user change state/filing status, so the
  // jurisdiction is the FORM's, not the household's (contract §3). `taxItems` is
  // still read directly below for the city-cascade filter.
  const tax = useHouseholdTaxContext();
  const resolvedYear = tax.resolvedYear;

  // ---- form values seeded from the household/persons profile ----
  //
  // MF-4 / PC-1 — use the RHF `values`-prop pattern (NOT
  // `useEffect(() => setForm(defaults), [defaults])`) AND pass
  // `resetOptions: { keepDirtyValues: true }`.
  //
  // Why both halves are required (traced against react-hook-form 7.75.0
  // source, `_reset`):
  //   - The stores (household/persons/dependents) hydrate ASYNCHRONOUSLY. This
  //     page only boots tax-rules; `household` is loaded lazily by
  //     `AppDisclaimerGate`, and `persons`/`dependents` may hydrate later still.
  //     So a user who deep-links here can land with `household == null`
  //     (`values === undefined`, form shows FORM_FALLBACK), start typing, and
  //     THEN have a store resolve — flipping `values` to a deep-different
  //     object.
  //   - On a `values` reference change RHF runs `_reset(values, …)`. **By
  //     default `_reset` overwrites EVERY mounted field, dirty or not** — it
  //     does NOT diff-and-preserve touched fields. (The only thing the bare
  //     `values` prop gives you is a deepEqual SHORT-CIRCUIT that skips the
  //     reset when the new seed equals the last one — that is "don't reset on
  //     identical data," not "preserve edits.")
  //   - `resetOptions: { keepDirtyValues: true }` selects the branch in
  //     `_reset` that keeps fields the user has modified while still applying
  //     the new seed to UNtouched fields. THIS is what makes a late
  //     multi-store hydration safe on a what-if scratchpad whose whole point is
  //     typing values that diverge from the saved profile.
  //
  // (`HouseholdForm.tsx` uses the bare `values` prop without `keepDirtyValues`
  // and that's fine there — it's an "edit your saved household" form where the
  // seed equals what's persisted and the user isn't mid-typing during a lazy
  // multi-store hydration. This what-if page is the one place the missing
  // option is exposed.)
  // Household-combined defaults (spec §4 "Defaults seeding" + §10 item 1): a
  // SINGLE input set summed across ALL persons — sum of salaries, summed health/
  // HSA/DCFSA, and a salary-BLENDED 401(k) % — mirroring PaycheckCard's
  // `for (const p of persons)` accumulation. Seeding from `persons[0]` alone
  // would under-count a 2-earner household's pre-tax and diverge from the
  // dashboard card. For a single earner this collapses to that person's values
  // exactly (sum/blend of one), so the common case is unchanged. The blended
  // 401(k) fraction is `Σ(pctᵢ·salaryᵢ) / Σ salaryᵢ`, so `pct·totalSalary`
  // equals the exact dollar-sum of per-person 401(k) contributions.
  const combined = useMemo(() => {
    const salary = persons.reduce((s, p) => s + p.annualSalaryPretax, 0);
    const k401Dollars = persons.reduce((s, p) => s + p.pretax401kPct * p.annualSalaryPretax, 0);
    return {
      salary,
      pretax401kFraction: salary > 0 ? k401Dollars / salary : (persons[0]?.pretax401kPct ?? 0),
      healthMonthly: persons.reduce((s, p) => s + p.healthInsuranceMonthlyPremium, 0),
      hsaMonthly: persons.reduce((s, p) => s + p.hsaMonthlyContribution, 0),
      dcfsaMonthly: persons.reduce((s, p) => s + p.dependentCareFsaMonthly, 0),
    };
  }, [persons]);

  const values = useMemo<FormValues | undefined>(() => {
    if (!household) return undefined;
    return {
      grossAnnual: combined.salary || 0,
      payFrequency: 'ANNUAL',
      filingStatus: household.filingStatus,
      dependents: dependents.length,
      state: household.state ?? 'CA',
      city: household.city ?? null,
      pretax401kPct: Math.round(combined.pretax401kFraction * 100),
      healthMonthly: combined.healthMonthly,
      hsaMonthly: combined.hsaMonthly,
      fsaMonthly: 0,
      roth401kPct: 0,
      otherPostTaxMonthly: 0,
      extraFederalPerPaycheck: 0,
    };
  }, [household, combined, dependents]);

  const form = useForm<FormValues>({
    resolver: zodResolver(PaycheckFormSchema),
    defaultValues: FORM_FALLBACK,
    values,
    // PC-1: preserve in-progress edits when a late store hydration changes
    // `values`. Without this, `_reset` overwrites the field the user is typing.
    resetOptions: { keepDirtyValues: true },
  });

  // Subscribe to the live form state so the computation + bindings re-render
  // on every keystroke. `watch()` (no args) returns the whole values object.
  // `register(..., { valueAsNumber: true })` yields NaN for a transiently
  // empty input; coerce NaN -> 0 for the numeric fields so the computation
  // never sees NaN. (The raw register'd value still drives the input element,
  // so the user can clear-and-retype normally.)
  const raw = form.watch();
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const f = {
    ...raw,
    grossAnnual: num(raw.grossAnnual),
    dependents: num(raw.dependents),
    pretax401kPct: num(raw.pretax401kPct),
    healthMonthly: num(raw.healthMonthly),
    hsaMonthly: num(raw.hsaMonthly),
    fsaMonthly: num(raw.fsaMonthly),
    roth401kPct: num(raw.roth401kPct),
    otherPostTaxMonthly: num(raw.otherPostTaxMonthly),
    extraFederalPerPaycheck: num(raw.extraFederalPerPaycheck),
  };

  // ---- bracket lookup ----
  // Use the hook's raw `lookup(jt, code, fs)` (Wave 0b), parameterized by the
  // FORM's editable filing status — this is the editable-jurisdiction path the
  // coordination contract §3 calls out (the household-bound `tax.federal`/
  // `tax.state`/`tax.city` would ignore the user's in-form state/filing-status
  // changes). The `resolvedYear` filtering lives inside the hook's `lookup`.
  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string) =>
    tax.lookup(jt, code, f.filingStatus);

  // City options scoped to the selected state (reuses the HouseholdForm pattern).
  const cityRules = useMemo(
    () =>
      taxItems.filter(
        (r) =>
          r.jurisdictionType === 'CITY' &&
          r.filingStatus === 'SINGLE' &&
          r.jurisdictionCode.startsWith(`${f.state}_`),
      ),
    [taxItems, f.state],
  );

  // When the state changes, clear a city whose prefix no longer matches
  // (mirrors HouseholdForm.tsx:141-146 — a separate effect, never during render).
  useEffect(() => {
    const currentCity = form.getValues('city');
    if (currentCity && !currentCity.startsWith(`${f.state}_`)) {
      form.setValue('city', null, { shouldDirty: true });
    }
  }, [f.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the annual computation ----
  // Reads the watched values `f`. The Finance-verified math (FICA split
  // thresholds, pre/post-tax base handling) is unchanged from the prior
  // revision — only the value SOURCE moved from useState to RHF `watch()`.
  const result = useMemo(() => {
    const federal = lookup('FEDERAL', 'US');
    const state = lookup('STATE', f.state);
    const city = f.city ? lookup('CITY', f.city) : null;
    if (!federal || !state) return null;

    const gross = f.grossAnnual;
    const pretax = computePretaxDeductions({
      salary: gross,
      pretax401kPct: f.pretax401kPct / 100,
      healthInsuranceMonthlyPremium: f.healthMonthly,
      // Dependent-care FSA is carried from the profile (spec §4 default source)
      // — there is no DCFSA input on this page, but dropping it would diverge
      // from the dashboard card, which includes it. Capped inside
      // computePretaxDeductions via dcfsaLimit(filingStatus).
      dcfsaMonthly: combined.dcfsaMonthly,
      hsaMonthly: f.hsaMonthly,
      hsaEligible: f.hsaMonthly > 0,
      filingStatus: f.filingStatus,
      personCount: Math.max(persons.length, 1),
      dependentCount: f.dependents,
    });
    // FSA reuses the §125 pre-tax math path (additive, disclosed).
    // Finance #2: clamp the health-FSA contribution to the 2026 IRS limit,
    // exactly as 401(k)/HSA/DCFSA are capped inside computePretaxDeductions
    // (tax.ts:63,66 via CONTRIBUTION_LIMITS_2026 / dcfsaLimit). Without this,
    // an FSA election above the annual limit understates taxable income.
    // Sourced from CONTRIBUTION_LIMITS_2026.HEALTH_FSA — see the FLAG below:
    // that constant must be added to src/lib/contribution-limits.ts (the file
    // is out of this plan's edit scope), so this line stays a single named
    // reference rather than an inline magic number.
    const fsaAnnual = Math.min(f.fsaMonthly * 12, CONTRIBUTION_LIMITS_2026.HEALTH_FSA);
    const pretaxTotal = pretax.total + fsaAnnual;

    const tax = computeTotalTax({
      gross,
      filingStatus: f.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: {
        federal: federal.standardDeduction,
        state: state.standardDeduction,
        city: city?.standardDeduction ?? 0,
      },
      pretax: {
        pretax401k: pretax.pretax401k,
        pretaxHealth: pretax.pretaxHealth + fsaAnnual, // FSA folded into the §125 bucket
        pretaxDcfsa: pretax.pretaxDcfsa,
        pretaxHsa: pretax.pretaxHsa,
      },
    });

    const fica = computeFicaBreakdown(gross, f.filingStatus);

    const postTaxTotal = (gross * f.roth401kPct) / 100 + f.otherPostTaxMonthly * 12;
    const extraWithholdingTotal =
      f.extraFederalPerPaycheck * periodsPerYear(f.payFrequency);

    const takeHome = computeTakeHome({
      gross,
      pretaxTotal,
      taxTotal: tax.total,
      postTaxTotal,
      extraWithholdingTotal,
    });

    return {
      gross,
      federal: tax.federal,
      ss: fica.socialSecurity,
      medicare: fica.medicare,
      additionalMedicare: fica.additionalMedicare,
      stateTax: tax.state,
      cityTax: tax.city,
      // No-state-tax detection: 0002_seed_tax_rules.sql stores no-income-tax
      // states (TX/FL/NV/SD/TN/WY/AK/WA) as a single ZERO-RATE bracket, not an
      // empty list (schema requires >=1 bracket). So detect "no state tax" by
      // the absence of any positive rate — NOT by `brackets.length` (which is
      // always >=1 and would wrongly show a literal "$0" for every no-tax state).
      hasStateTax: state.brackets.some((b) => b.rate > 0),
      hasCity: !!city,
      pretaxTotal,
      postTaxTotal,
      extraWithholdingTotal,
      takeHome,
    };
    // Depend on the individual watched primitives (not the freshly-spread `f`
    // object, which would change every render). `persons.length` covers the
    // HSA/personCount input.
  }, [
    f.grossAnnual, f.payFrequency, f.filingStatus, f.dependents, f.state, f.city,
    f.pretax401kPct, f.healthMonthly, f.hsaMonthly, f.fsaMonthly,
    f.roth401kPct, f.otherPostTaxMonthly, f.extraFederalPerPaycheck,
    taxItems, resolvedYear, persons.length, combined.dcfsaMonthly,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Results "Show as" display period (independent of the Income pay frequency).
  const [displayPeriod, setDisplayPeriod] = useState<PaycheckPeriod>('MONTHLY');
  const div = periodsPerYear(displayPeriod);
  const displayLabel =
    PAYCHECK_PERIODS.find((p) => p.id === displayPeriod)?.label.toLowerCase() ?? 'month';

  // PC-2 note: the results panel shows the empty-state CTA when the engine
  // can't run (no household / missing brackets → `result` is null) OR when
  // there is no person to compute for. Tax-rule brackets ship via seed
  // migrations, so `result` is non-null even for a household with zero persons
  // (gross 0) — without the persons-length gate the panel would render a
  // misleading "$0 / month, 0.0% of gross" headline (the zero-state WhatIf was
  // redesigned to avoid). The gate is written inline in the JSX below
  // (`!result || persons.length === 0`) so TS narrows `result` in the result
  // branch — see the comment there.

  return (
    <div className="space-y-4 min-w-0">
      {/* W2 / BT-6 — shared card→detail back-nav: the house-style affordance for
          every calculator detail route spun out of the /calculators grid (a
          lucide `ArrowLeft h-4 w-4` + `text-sm text-muted-foreground`, above the
          <h1>). The historical-backtest detail route (/calculators/backtest),
          specified in docs/superpowers/plans/2026-05-28-historical-backtest-plan.md
          and built next in the sequence, will reuse this IDENTICAL element so the
          two detail pages don't drift. (Today this is the only such page.) */}
      <Link
        to="/calculators"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to calculators
      </Link>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Paycheck calculator</h1>
          <p className="text-sm text-muted-foreground">
            Estimate your take-home pay after taxes and deductions.
          </p>
        </div>
        {resolvedYear && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info-soft px-2.5 py-1 text-xs text-info-foreground">
            Based on {resolvedYear} tax-year brackets
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-5 items-start min-w-0">
        {/* ---------- LEFT: inputs ---------- */}
        <Card className="min-w-0">
          <CardContent className="space-y-6 pt-6">
            {/* M5b — "Reset to my data" revert. The crossover review required a
                deliberate-revert control on this full-page form (keepDirtyValues
                solves LATE-hydration clobber, not an intentional "throw away my
                edits"). `form.reset(values)` snaps every field back to the
                seeded profile (the same memoized `values` the `values` prop
                feeds); guarded by `!values` (nothing seeded yet → nothing to
                revert to) and `!isDirty` (no edits → no-op). The exact canonical
                string is "Reset to my data". */}
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                disabled={!values || !form.formState.isDirty}
                onClick={() => values && form.reset(values, { keepDirtyValues: false })}
              >
                Reset to my data
              </Button>
            </div>
            {/* Income */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="grossAnnual">Gross pay ($/yr)</Label>
                  <Input
                    id="grossAnnual"
                    type="number"
                    step="any"
                    {...form.register('grossAnnual', { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <Label htmlFor="payFrequency">Pay frequency</Label>
                  <select
                    id="payFrequency"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={f.payFrequency}
                    onChange={(e) =>
                      form.setValue('payFrequency', e.target.value as PaycheckPeriod, {
                        shouldDirty: true,
                      })
                    }
                  >
                    {PAYCHECK_PERIODS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Where you live */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where you live</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="filingStatus">Filing status</Label>
                  <select
                    id="filingStatus"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={f.filingStatus}
                    onChange={(e) =>
                      form.setValue('filingStatus', e.target.value as FilingStatus, {
                        shouldDirty: true,
                      })
                    }
                  >
                    <option value="SINGLE">Single</option>
                    <option value="MFJ">Married filing jointly</option>
                    <option value="MFS">Married filing separately</option>
                    <option value="HOH">Head of household</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="dependents">Dependents</Label>
                  <Input
                    id="dependents"
                    type="number"
                    min={0}
                    step={1}
                    {...form.register('dependents', { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    maxLength={2}
                    list="paycheck-us-states"
                    value={f.state}
                    onChange={(e) =>
                      // Uppercase as the user types; the separate effect above
                      // clears a now-mismatched city. Keep this onChange (not
                      // register) because of the toUpperCase transform.
                      form.setValue('state', e.target.value.toUpperCase(), {
                        shouldDirty: true,
                      })
                    }
                  />
                  <datalist id="paycheck-us-states">
                    {US_STATES.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <Label htmlFor="city">City / locality (if applicable)</Label>
                  <select
                    id="city"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm disabled:opacity-60"
                    value={f.city ?? ''}
                    disabled={cityRules.length === 0}
                    onChange={(e) =>
                      form.setValue('city', e.target.value === '' ? null : e.target.value, {
                        shouldDirty: true,
                      })
                    }
                  >
                    <option value="">
                      {/* PC-3 consistency: "— No localities listed —" describes the
                          (non-exhaustive) seed for this state, not an absolute
                          absence-of-local-tax claim. */}
                      {cityRules.length === 0 ? '— No localities listed —' : '(No local tax)'}
                    </option>
                    {cityRules.map((r) => (
                      <option key={r.jurisdictionCode} value={r.jurisdictionCode}>
                        {prettifyCityCode(r.jurisdictionCode)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Pre-tax deductions */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pre-tax deductions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pretax401kPct"><TermTooltip term="401(k)">401(k)</TermTooltip> (%)</Label>
                  {/* a11y (UX #2): the <Label> wraps the term in a <TermTooltip>
                      <button>, so AT/Testing-Library strip that text and the
                      field's accessible name collapses to just "(%)". An explicit
                      aria-label restores the full human name for screen readers. */}
                  <Input id="pretax401kPct" type="number" step="any"
                    aria-label="Pre-tax 401(k) contribution (% of gross)"
                    {...form.register('pretax401kPct', { valueAsNumber: true })} />
                </div>
                <div>
                  <Label htmlFor="healthMonthly">Health premium ($/mo)</Label>
                  <Input id="healthMonthly" type="number" step="any"
                    {...form.register('healthMonthly', { valueAsNumber: true })} />
                </div>
                <div>
                  <Label htmlFor="hsaMonthly"><TermTooltip term="HSA">HSA</TermTooltip> ($/mo)</Label>
                  {/* a11y (UX #2): TermTooltip-in-label — see pretax 401(k) note. */}
                  <Input id="hsaMonthly" type="number" step="any"
                    aria-label="HSA contribution ($/month)"
                    {...form.register('hsaMonthly', { valueAsNumber: true })} />
                </div>
                <div>
                  <Label htmlFor="fsaMonthly"><TermTooltip term="FSA">FSA</TermTooltip> ($/mo)</Label>
                  {/* a11y (UX #2): TermTooltip-in-label — see pretax 401(k) note. */}
                  <Input id="fsaMonthly" type="number" step="any"
                    aria-label="Health FSA contribution ($/month)"
                    {...form.register('fsaMonthly', { valueAsNumber: true })} />
                </div>
              </div>
            </section>

            {/* Post-tax deductions */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Post-tax deductions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="roth401kPct">Roth 401(k) (%)</Label>
                  <Input id="roth401kPct" type="number" step="any"
                    {...form.register('roth401kPct', { valueAsNumber: true })} />
                </div>
                <div>
                  <Label htmlFor="otherPostTaxMonthly"><TermTooltip term="ESPP">ESPP</TermTooltip> ($/mo)</Label>
                  {/* a11y (UX #2): TermTooltip-in-label — see pretax 401(k) note. */}
                  <Input id="otherPostTaxMonthly" type="number" step="any"
                    aria-label="ESPP contribution ($/month)"
                    {...form.register('otherPostTaxMonthly', { valueAsNumber: true })} />
                </div>
              </div>
            </section>

            {/* Withholding adjustments */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Withholding adjustments
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="extraFederalPerPaycheck">Extra federal withholding ($/paycheck)</Label>
                  <Input id="extraFederalPerPaycheck" type="number" step="any"
                    {...form.register('extraFederalPerPaycheck', { valueAsNumber: true })} />
                </div>
              </div>
              <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">No allowances field.</strong> The IRS
                removed withholding allowances from the W-4 in 2020. Modern withholding uses
                filing status, dependents, and the dollar adjustment above — so Cairn omits
                the legacy allowances input entirely.
              </div>
            </section>
          </CardContent>
        </Card>

        {/* ---------- RIGHT: sticky results ---------- */}
        <Card className="min-w-0 lg:sticky lg:top-6 overflow-hidden">
          {/* PC-2: gate on (no result OR no person), not just `!result`. Write
              the condition INLINE (not via the `showEmpty` const) so TS's
              control-flow analysis narrows `result` to non-null in the `: (`
              branch — a separate boolean const would NOT narrow it, and the
              branch dereferences `result.takeHome` etc. */}
          {!result || persons.length === 0 ? (
            <CardContent className="pt-6">
              {/* Cohesive with WhatIf.tsx's centered empty-state (WhatIf.tsx:250-266):
                  a muted prompt + underlined Links to the inputs the user can fill.
                  Tax-rule brackets ship via seed migrations (0002/0031) — the
                  actionable setup is at least one person + the household profile. */}
              <div
                className="py-12 text-center text-muted-foreground"
                data-testid="paycheck-calc-empty"
              >
                <p className="mb-3 text-sm">
                  Add a person and set up your household to estimate take-home pay.
                </p>
                <div className="flex flex-wrap justify-center gap-2 text-sm">
                  <Link to="/inputs/persons" className="underline text-foreground">
                    Add a person
                  </Link>
                  <span aria-hidden="true">·</span>
                  <Link to="/inputs/household" className="underline text-foreground">
                    Set up household
                  </Link>
                </div>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="bg-success-soft border-b">
                <div className="text-xs font-semibold uppercase tracking-wide text-success-foreground">
                  Estimated take-home pay
                </div>
                <div className="text-3xl sm:text-4xl font-semibold tabular-nums text-success-foreground">
                  <span data-testid="paycheck-calc-takehome">{formatCurrency(result.takeHome / div)}</span>
                  <span className="text-base font-medium"> / {displayLabel}</span>
                </div>
                <div className="text-sm text-success-foreground/90 tabular-nums">
                  <strong>{formatCurrency(result.takeHome)}</strong> per year · that's{' '}
                  <strong>{result.gross > 0 ? ((result.takeHome / result.gross) * 100).toFixed(1) : '0.0'}%</strong> of gross
                </div>
              </CardHeader>

              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
                <span>Show as:</span>
                <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted p-1">
                  {(['ANNUAL', 'MONTHLY', 'SEMI_MONTHLY', 'BI_WEEKLY'] as PaycheckPeriod[]).map((pid) => {
                    const d = PAYCHECK_PERIODS.find((p) => p.id === pid)!;
                    const active = displayPeriod === pid;
                    return (
                      <Button
                        key={pid}
                        type="button"
                        size="sm"
                        variant={active ? 'secondary' : 'ghost'}
                        className="h-7"
                        aria-pressed={active}
                        onClick={() => setDisplayPeriod(pid)}
                      >
                        {d.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <CardContent className="space-y-4 pt-4">
                <DonutChartCardSlices result={result} />

                <div>
                  <PaycheckBreakdownRow label="Gross pay" amount={result.gross / div} grossForPct={0} color={COLORS.gross} />
                  <PaycheckBreakdownRow label="Federal withholding" amount={result.federal / div} grossForPct={result.gross / div} color={COLORS.federal} negative />
                  <PaycheckBreakdownRow label="Social Security" sublabel="6.2% to wage base" amount={result.ss / div} grossForPct={result.gross / div} color={COLORS.ss} negative />
                  <PaycheckBreakdownRow
                    label="Medicare"
                    sublabel="1.45%"
                    amount={(result.medicare + result.additionalMedicare) / div}
                    grossForPct={result.gross / div}
                    color={COLORS.medicare}
                    negative
                    showAdditionalMedicareTag={result.additionalMedicare > 0}
                  />
                  <PaycheckBreakdownRow
                    label="State income tax"
                    sublabel={undefined}
                    amount={result.stateTax / div}
                    grossForPct={result.gross / div}
                    color={COLORS.state}
                    negative
                    emptyNote={result.hasStateTax ? undefined : '(no state income tax)'}
                  />
                  {/* PC-3: "(no local tax modeled here)" — NOT "(none in this
                      state)". The ~250-jurisdiction seed can't back an
                      absence-of-tax assertion (PA/OH/KY have many more locals
                      than are seeded), and an absolute claim contradicts the
                      page's own "estimates" fine print. */}
                  <PaycheckBreakdownRow
                    label="Local / city tax"
                    amount={result.cityTax / div}
                    grossForPct={result.gross / div}
                    color={COLORS.city}
                    negative
                    emptyNote={result.hasCity ? undefined : '(no local tax modeled here)'}
                  />
                  <PaycheckBreakdownRow label="Pre-tax deductions" amount={result.pretaxTotal / div} grossForPct={result.gross / div} color={COLORS.pretax} negative variant="subtotal" />
                  {result.postTaxTotal > 0 && (
                    <PaycheckBreakdownRow label="Post-tax deductions" amount={result.postTaxTotal / div} grossForPct={result.gross / div} color={COLORS.posttax} negative variant="subtotal" />
                  )}
                  {result.extraWithholdingTotal > 0 && (
                    <PaycheckBreakdownRow label="Extra withholding" amount={result.extraWithholdingTotal / div} grossForPct={result.gross / div} color={COLORS.extra} negative variant="subtotal" />
                  )}
                  <PaycheckBreakdownRow label="Take-home pay" amount={result.takeHome / div} grossForPct={result.gross / div} color={COLORS.takehome} variant="total" />
                </div>

                {result.extraWithholdingTotal > 0 && (
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Extra federal withholding changes <em>when</em> tax is collected (more
                    per paycheck now, a larger refund or smaller bill at filing) — it does
                    not change the total tax you owe for the year.
                  </p>
                )}
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Estimates reflect {resolvedYear} federal and {f.state} brackets. They
                  don't replace your actual pay stub — see the notes below.
                </p>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* ---------- Explainer + disclosure ---------- */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold">How your paycheck is calculated</h2>
            <p className="text-sm text-muted-foreground">
              Four things come out between gross and take-home. Here's the order Cairn applies them.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-7 gap-y-4">
            <div>
              <h3 className="text-sm font-semibold">1 · Pre-tax deductions come off first</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your 401(k), <TermTooltip term="HSA">HSA</TermTooltip>,{' '}
                <TermTooltip term="FSA">FSA</TermTooltip>, and health premiums are subtracted
                before any tax is figured, lowering the income your federal and state taxes are
                calculated on.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">2 · Federal withholding</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We estimate federal income tax from the {resolvedYear} brackets using your filing
                status, dependents, and the standard deduction. There are no W-4 "allowances"
                anymore; dependents and any extra dollar amount do that job now.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">3 · <TermTooltip term="FICA">FICA</TermTooltip> — Social Security &amp; Medicare</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A flat payroll tax: 6.2% Social Security (up to the annual wage base) and 1.45%
                Medicare. High earners pay an extra 0.9% Additional Medicare above $200k (single)
                / $250k (MFJ) — we surface that line only when it applies.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">4 · State &amp; local income tax</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                State tax varies widely — some states have none, others layer on city or county
                levies. Zero-tax states display an italic note in the state row instead of a
                $0 amount.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info-soft p-3 text-[12.5px] leading-relaxed text-info-foreground">
            <span>
              These figures are <strong>estimates for planning</strong>, not tax advice. Brackets
              reflect the <strong>{resolvedYear} tax year</strong> and are bundled with the app —
              verify against your pay stub or a tax professional before acting.
            </span>
          </div>

          {/* Ported from PaycheckCard.tsx:224-267, trimmed for items now modeled
              (post-tax + extra-withholding bullets removed). */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium hover:text-foreground">
              What this calculator does NOT model
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <TermTooltip term="FICA" /> is computed on your <strong>full gross</strong>.
                Real Social Security &amp; Medicare wages exclude §125 cafeteria-plan
                deductions (pre-tax health, <TermTooltip term="FSA">FSA</TermTooltip>,
                payroll-deducted <TermTooltip term="HSA">HSA</TermTooltip>), so Cairn
                slightly over-collects FICA when you use those — a small difference that
                matches SmartAsset's simplification.
              </li>
              <li>
                <TermTooltip term="NIIT">NIIT</TermTooltip> interactions and other high-earner
                secondary effects beyond the Additional Medicare line shown above.
              </li>
              <li>
                <TermTooltip term="AMT">AMT</TermTooltip> on ISO exercises landing in the same period.
              </li>
              <li>
                State Disability Insurance (CA SDI, NJ SDI, NY DBL) and state PFML deductions —
                withheld on top of state tax.
              </li>
              <li>
                Mid-year HSA / FSA contribution changes — we apply your current monthly election
                across the full year.
              </li>
              <li>
                Local rules for the ~250 city/county jurisdictions are estimates; unusual
                residency splits aren't handled.
              </li>
            </ul>
          </details>
          {/* (Back-nav lives at the top of the page — the shared W2 header
              affordance — so no duplicate footer back-link here.) */}
        </CardContent>
      </Card>
    </div>
  );
}

// Donut: gross → {Federal, SS, Medicare, State, City, Pre-tax, Take-home}.
// Wedge values are ANNUAL (the donut shows proportions; period scaling doesn't
// change them). Reuses DonutChartCard (isAnimationActive already disabled there).
function DonutChartCardSlices({
  result,
}: {
  result: {
    federal: number; ss: number; medicare: number; additionalMedicare: number;
    stateTax: number; cityTax: number; pretaxTotal: number; postTaxTotal: number;
    extraWithholdingTotal: number; takeHome: number;
  };
}) {
  // NOTE: donut slice names are SHORT labels (legend only) — they intentionally
  // differ from the breakdown-row text labels ("Social Security" in the row vs.
  // "SS" in the legend) so that Testing Library `findByText` queries in the
  // results panel remain unambiguous. Keep these short names distinct from
  // the breakdown row labels in PaycheckCalculator.tsx.
  const slices: DonutSlice[] = [
    { name: 'Take-home', value: result.takeHome, color: COLORS.takehome },
    { name: 'Federal', value: result.federal, color: COLORS.federal },
    { name: 'SS', value: result.ss, color: COLORS.ss },
    { name: 'Med.', value: result.medicare + result.additionalMedicare, color: COLORS.medicare },
    { name: 'State tax', value: result.stateTax, color: COLORS.state },
    { name: 'City tax', value: result.cityTax, color: COLORS.city },
    { name: 'Pre-tax', value: result.pretaxTotal, color: COLORS.pretax },
    { name: 'Post-tax', value: result.postTaxTotal, color: COLORS.posttax },
    { name: 'Extra w/h', value: result.extraWithholdingTotal, color: COLORS.extra },
  ].filter((s) => s.value > 0);

  return (
    <DonutChartCard
      title="Where your paycheck goes"
      height={200}
      data={slices}
      innerRadius={52}
      outerRadius={80}
      valueFormatter={formatCurrency}
    />
  );
}
