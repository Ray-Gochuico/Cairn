import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { CategoryMultiSelect } from '@/components/categories/CategoryMultiSelect';
import { FiPillsPosition, ProjectionDetailLevel, CompoundingFrequency } from '@/types/enums';
import { ResetDisclaimersDialog } from './ResetDisclaimersDialog';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

/**
 * Settings → Advanced. Collapsed by default to keep the section
 * unobtrusive — most users never need to touch the threshold defaults
 * or hit the reset button. Currently exposes:
 *
 *   1. Interest-rate threshold overrides — low % and high %. Empty
 *      inputs persist as null so the household falls back to the
 *      app-wide 5% / 8% defaults. Validation enforces `low < high` and
 *      both 0..100. Save is disabled while invalid.
 *   2. What-If projection defaults — default inflation and default
 *      investment return rate, surfaced as whole percent values but
 *      persisted as fractions on app_settings. Blank inputs persist
 *      as null so the projection engine's built-in defaults apply.
 *   3. Reset disclaimer acceptances — opens ResetDisclaimersDialog.
 *      Useful for QA/testing; not destructive (audit log is preserved).
 */
export function AdvancedSection() {
  const household = useHouseholdStore((s) => s.household);
  const load = useHouseholdStore((s) => s.load);
  const update = useHouseholdStore((s) => s.update);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const updateSettings = useSettingsStore((s) => s.update);

  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const [open, setOpen] = useState(false);
  const [low, setLow] = useState<string>('');
  const [high, setHigh] = useState<string>('');
  const [inflation, setInflation] = useState<string>('');
  const [returnRate, setReturnRate] = useState<string>('');
  const [pillsPosition, setPillsPosition] = useState<FiPillsPosition>(FiPillsPosition.ABOVE);
  const [projDetailLevel, setProjDetailLevel] = useState<ProjectionDetailLevel>(
    ProjectionDetailLevel.TAX_BUCKET,
  );
  const [cashApy, setCashApy] = useState<string>('');
  const [compoundingFrequency, setCompoundingFrequency] = useState<CompoundingFrequency>(
    CompoundingFrequency.MONTHLY,
  );
  // Default effective tax rate on retirement withdrawals (Trad bucket).
  // Persists on app_settings as a fraction (0.22), surfaced as whole-percent.
  // The 22% UI default (when the field is empty/unset) reflects Finance
  // review NEW-W5-1 guidance: blended federal + FICA + average state for
  // a typical $60k/yr drawdown. Users can blank the field to set the
  // setting to null (engine falls back to legacy net-equals-gross).
  const [drawdownTaxRate, setDrawdownTaxRate] = useState<string>('');
  const [resetOpen, setResetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Mirror the household values into the inputs on every change. The
  // user can override them, but if they re-open the page later it
  // should show whatever is currently persisted.
  useEffect(() => {
    setLow(
      household?.interestThresholdLowPct == null
        ? ''
        : String(household.interestThresholdLowPct),
    );
    setHigh(
      household?.interestThresholdHighPct == null
        ? ''
        : String(household.interestThresholdHighPct),
    );
  }, [household?.interestThresholdLowPct, household?.interestThresholdHighPct]);

  // What-If defaults persist as fractions on app_settings; surface them
  // as whole-percent values in the inputs.
  useEffect(() => {
    setInflation(
      settings?.defaultInflation == null
        ? ''
        : String(Math.round(settings.defaultInflation * 1000) / 10),
    );
    setReturnRate(
      settings?.defaultReturnRate == null
        ? ''
        : String(Math.round(settings.defaultReturnRate * 1000) / 10),
    );
  }, [settings?.defaultInflation, settings?.defaultReturnRate]);

  // FI/Coast FI pill row position — household-default surfaced in the same
  // What-If section as the projection-default inputs.
  useEffect(() => {
    setPillsPosition(settings?.defaultFiPillsPosition ?? FiPillsPosition.ABOVE);
  }, [settings?.defaultFiPillsPosition]);

  // Projection detail level — household-default surfaced alongside the
  // FI/Coast FI pill position select.
  useEffect(() => {
    setProjDetailLevel(settings?.defaultProjectionDetailLevel ?? ProjectionDetailLevel.TAX_BUCKET);
  }, [settings?.defaultProjectionDetailLevel]);

  // Default cash APY — household-level fallback used when an account's APY is
  // blank. Persists as a fraction; surfaced as a percentage value.
  useEffect(() => {
    setCashApy(
      settings?.defaultCashApy == null
        ? ''
        : String(Math.round(settings.defaultCashApy * 1000) / 10),
    );
  }, [settings?.defaultCashApy]);

  // Default compounding frequency — household-level default for the Returns
  // lever. Per-scenario overrides win at projection time.
  useEffect(() => {
    setCompoundingFrequency(
      settings?.defaultCompoundingFrequency ?? CompoundingFrequency.MONTHLY,
    );
  }, [settings?.defaultCompoundingFrequency]);

  // Default drawdown tax rate — household-level default for the engine's
  // Trad-bucket gross-up under the sequential withdrawal strategy. Persists
  // as a fraction; surfaced as a whole-percent value.
  useEffect(() => {
    setDrawdownTaxRate(
      settings?.defaultDrawdownTaxRate == null
        ? ''
        : String(Math.round(settings.defaultDrawdownTaxRate * 1000) / 10),
    );
  }, [settings?.defaultDrawdownTaxRate]);

  const lowNum = low.trim() === '' ? null : Number(low);
  const highNum = high.trim() === '' ? null : Number(high);
  const lowInvalid = lowNum !== null && (Number.isNaN(lowNum) || lowNum < 0 || lowNum > 100);
  const highInvalid = highNum !== null && (Number.isNaN(highNum) || highNum < 0 || highNum > 100);
  const orderInvalid = lowNum !== null && highNum !== null && lowNum >= highNum;
  const thresholdInvalid = lowInvalid || highInvalid || orderInvalid;

  const inflationNum = inflation.trim() === '' ? null : Number(inflation);
  const returnNum = returnRate.trim() === '' ? null : Number(returnRate);
  const inflationInvalid =
    inflationNum !== null && (Number.isNaN(inflationNum) || inflationNum < 0 || inflationNum > 20);
  const returnInvalid =
    returnNum !== null && (Number.isNaN(returnNum) || returnNum < -50 || returnNum > 50);

  const cashApyNum = cashApy.trim() === '' ? null : Number(cashApy);
  const cashApyInvalid =
    cashApyNum !== null && (Number.isNaN(cashApyNum) || cashApyNum < 0 || cashApyNum > 15);

  // Drawdown tax rate: 0..50% range (matches Zod min(0).max(0.5) on the
  // app_settings column). Blank → null persisted; user gets a clear
  // "no household default" state.
  const drawdownTaxRateNum = drawdownTaxRate.trim() === '' ? null : Number(drawdownTaxRate);
  const drawdownTaxRateInvalid =
    drawdownTaxRateNum !== null &&
    (Number.isNaN(drawdownTaxRateNum) || drawdownTaxRateNum < 0 || drawdownTaxRateNum > 50);

  const invalid =
    thresholdInvalid ||
    inflationInvalid ||
    returnInvalid ||
    cashApyInvalid ||
    drawdownTaxRateInvalid;

  const handleSave = async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    try {
      await update({
        interestThresholdLowPct: lowNum,
        interestThresholdHighPct: highNum,
      });
      await updateSettings({
        defaultInflation: inflationNum === null ? null : inflationNum / 100,
        defaultReturnRate: returnNum === null ? null : returnNum / 100,
        defaultFiPillsPosition: pillsPosition,
        defaultProjectionDetailLevel: projDetailLevel,
        defaultCashApy: cashApyNum === null ? null : cashApyNum / 100,
        defaultCompoundingFrequency: compoundingFrequency,
        defaultDrawdownTaxRate:
          drawdownTaxRateNum === null ? null : drawdownTaxRateNum / 100,
      });
      setSavedAt(Date.now());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex items-center justify-between">
          <span>Advanced</span>
          <button
            type="button"
            className="text-slate-500 hover:text-slate-900"
            aria-label={open ? 'Collapse Advanced' : 'Expand Advanced'}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6">
          <section>
            <h4 className="text-sm font-medium mb-1">Interest-rate thresholds</h4>
            <p className="text-xs text-slate-500 mb-3">
              Default cutoffs are 5% (low) and 8% (high). Leave blank to use the defaults.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="advanced-low">Low cutoff (%)</Label>
                <Input
                  id="advanced-low"
                  type="number"
                  step="0.1"
                  value={low}
                  onChange={(e) => setLow(e.target.value)}
                  className="w-24"
                  aria-invalid={lowInvalid || orderInvalid}
                />
              </div>
              <div>
                <Label htmlFor="advanced-high">High cutoff (%)</Label>
                <Input
                  id="advanced-high"
                  type="number"
                  step="0.1"
                  value={high}
                  onChange={(e) => setHigh(e.target.value)}
                  className="w-24"
                  aria-invalid={highInvalid || orderInvalid}
                />
              </div>
            </div>
            {thresholdInvalid && (
              <div className="text-xs text-destructive mt-2" role="alert">
                {orderInvalid
                  ? 'Low cutoff must be less than high cutoff.'
                  : 'Both cutoffs must be between 0 and 100.'}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium mb-1">What-If projection defaults</h4>
            <p className="text-xs text-slate-500 mb-2">
              Defaults to 2.5% inflation and 7.0% return when blank. Used by the What-If chart&apos;s
              nominal/real toggle and the Returns lever fallback.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="default-inflation">Default inflation rate (%)</Label>
                <Input
                  id="default-inflation"
                  type="number"
                  step="0.1"
                  min="0"
                  max="20"
                  value={inflation}
                  onChange={(e) => setInflation(e.target.value)}
                  placeholder="2.5"
                  aria-invalid={inflationInvalid}
                  className="w-32"
                />
              </div>
              <div>
                <Label htmlFor="default-return">Default investment return rate (%)</Label>
                <Input
                  id="default-return"
                  type="number"
                  step="0.1"
                  min="-50"
                  max="50"
                  value={returnRate}
                  onChange={(e) => setReturnRate(e.target.value)}
                  placeholder="7.0"
                  aria-invalid={returnInvalid}
                  className="w-32"
                />
              </div>
            </div>
            {(inflationInvalid || returnInvalid) && (
              <div className="text-xs text-destructive mt-2" role="alert">
                {inflationInvalid
                  ? 'Inflation rate must be between 0 and 20.'
                  : 'Return rate must be between -50 and 50.'}
              </div>
            )}
            <div className="pt-1">
              <Label htmlFor="default-fi-pills-position">FI / Coast FI pills position</Label>
              <select
                id="default-fi-pills-position"
                className="mt-1 block h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"
                value={pillsPosition}
                onChange={(e) => setPillsPosition(e.target.value as FiPillsPosition)}
              >
                <option value={FiPillsPosition.ABOVE}>Above charts</option>
                <option value={FiPillsPosition.BELOW}>Below charts</option>
              </select>
            </div>
            <div className="pt-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="default-projection-detail-level">Projection detail level</Label>
                <TermTooltip term="Projection detail level">
                  <span className="sr-only">Projection detail level</span>
                </TermTooltip>
              </div>
              <select
                id="default-projection-detail-level"
                aria-label="Projection detail level"
                className="mt-1 block h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"
                value={projDetailLevel}
                onChange={(e) => setProjDetailLevel(e.target.value as ProjectionDetailLevel)}
              >
                <option value={ProjectionDetailLevel.SINGLE}>Single line</option>
                <option value={ProjectionDetailLevel.TAX_BUCKET}>Tax bucket (default)</option>
                <option value={ProjectionDetailLevel.PER_ACCOUNT}>Per account</option>
              </select>
            </div>
            <div className="pt-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="default-cash-apy">Default cash APY (%)</Label>
                <TermTooltip term="APY">
                  <span className="sr-only">APY</span>
                </TermTooltip>
              </div>
              <Input
                id="default-cash-apy"
                type="number"
                step="0.01"
                min="0"
                max="15"
                value={cashApy}
                onChange={(e) => setCashApy(e.target.value)}
                placeholder="0.0"
                aria-invalid={cashApyInvalid}
                className="w-32"
              />
              <p className="text-xs text-slate-500 mt-1">
                Used when an account&apos;s APY is blank. Falls through to 0% if also blank.
              </p>
            </div>
            {cashApyInvalid && (
              <div className="text-xs text-destructive mt-2" role="alert">
                Cash APY must be between 0 and 15.
              </div>
            )}
            <div className="pt-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="default-compounding-frequency">Default compounding frequency</Label>
                <TermTooltip term="Compounding frequency">
                  <span className="sr-only">Compounding frequency</span>
                </TermTooltip>
              </div>
              <select
                id="default-compounding-frequency"
                aria-label="Default compounding frequency"
                className="mt-1 block h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"
                value={compoundingFrequency}
                onChange={(e) =>
                  setCompoundingFrequency(e.target.value as CompoundingFrequency)
                }
              >
                <option value={CompoundingFrequency.DAILY}>Daily</option>
                <option value={CompoundingFrequency.WEEKLY}>Weekly</option>
                <option value={CompoundingFrequency.MONTHLY}>Monthly (default)</option>
                <option value={CompoundingFrequency.QUARTERLY}>Quarterly</option>
                <option value={CompoundingFrequency.ANNUALLY}>Annually</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Applies to investment returns and cash APY in new scenarios.
              </p>
            </div>
            <div className="pt-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="default-drawdown-tax-rate">
                  Default effective tax rate on retirement withdrawals (%)
                </Label>
                <TermTooltip term="Drawdown tax rate">
                  <span className="sr-only">Drawdown tax rate</span>
                </TermTooltip>
              </div>
              <Input
                id="default-drawdown-tax-rate"
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={drawdownTaxRate}
                onChange={(e) => setDrawdownTaxRate(e.target.value)}
                placeholder="22"
                aria-invalid={drawdownTaxRateInvalid}
                className="w-32"
              />
              <p className="text-xs text-slate-500 mt-1">
                Applied when What-If scenarios use the &quot;sequential&quot;
                withdrawal strategy. Default 22% (covers federal + FICA +
                average state for a $60k/yr drawdown). Leave blank to model
                net-of-tax withdrawals manually.
              </p>
            </div>
            {drawdownTaxRateInvalid && (
              <div className="text-xs text-destructive mt-2" role="alert">
                Drawdown tax rate must be between 0 and 50.
              </div>
            )}
            {/* NOTE (2026-05-26 revamp): the "Auto-invest salary surplus
                by default" toggle was removed. Routing now happens via the
                per-scenario gap allocation lever (Income popover). The
                migration 0029 column stays in the DB as a zombie. */}
          </section>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={invalid || submitting}>
              Save
            </Button>
            {savedAt && !invalid && (
              <span className="text-xs text-success">Saved</span>
            )}
          </div>

          <section className="space-y-3">
            <h4 className="text-sm font-medium mb-1">Property &amp; Vehicle stat categories</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm font-normal">
                    Property utilities categories
                  </Label>
                  <p className="text-xs text-slate-500">
                    Used by the Utilities card on every Property page. Falls back to
                    &quot;Home &rsaquo; Utilities&quot; when nothing is selected.
                  </p>
                </div>
                <CategoryMultiSelect
                  categories={categories}
                  selected={settings?.propertyUtilitiesCategoryIds ?? []}
                  onChange={(ids) =>
                    void updateSettings({
                      propertyUtilitiesCategoryIds: ids.length === 0 ? null : ids,
                    })
                  }
                  label="Utilities categories"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm font-normal">Vehicle gas categories</Label>
                  <p className="text-xs text-slate-500">
                    Used by the Gas card on every Vehicle page. Falls back to
                    &quot;Vehicles &rsaquo; Gas/Fuel&quot; when nothing is selected.
                  </p>
                </div>
                <CategoryMultiSelect
                  categories={categories}
                  selected={settings?.vehicleGasCategoryIds ?? []}
                  onChange={(ids) =>
                    void updateSettings({
                      vehicleGasCategoryIds: ids.length === 0 ? null : ids,
                    })
                  }
                  label="Gas categories"
                />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium mb-1">Bulk data import</h4>
            <p className="text-xs text-slate-500 mb-2">
              Re-open the setup wizard&apos;s history section to bulk-import
              account snapshots, asset value snapshots, contributions, or
              transactions.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href="/setup?section=4">Open import wizard →</a>
            </Button>
          </section>

          <section>
            <h4 className="text-sm font-medium mb-1">
              Reset disclaimer acceptances
            </h4>
            <p className="text-xs text-slate-500 mb-2">
              Clear the accepted-version flags so the app re-prompts at next
              launch and next Roadmap open. Useful for testing.
            </p>
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              Reset disclaimers
            </Button>
            <ResetDisclaimersDialog
              open={resetOpen}
              onOpenChange={setResetOpen}
            />
          </section>
        </CardContent>
      )}
    </Card>
  );
}

export default AdvancedSection;
