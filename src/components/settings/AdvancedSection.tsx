import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { ResetDisclaimersDialog } from './ResetDisclaimersDialog';

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

  const [open, setOpen] = useState(false);
  const [low, setLow] = useState<string>('');
  const [high, setHigh] = useState<string>('');
  const [inflation, setInflation] = useState<string>('');
  const [returnRate, setReturnRate] = useState<string>('');
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

  const invalid = thresholdInvalid || inflationInvalid || returnInvalid;

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
              <div className="text-xs text-red-700 mt-2" role="alert">
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
              <div className="text-xs text-red-700 mt-2" role="alert">
                {inflationInvalid
                  ? 'Inflation rate must be between 0 and 20.'
                  : 'Return rate must be between -50 and 50.'}
              </div>
            )}
          </section>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={invalid || submitting}>
              Save
            </Button>
            {savedAt && !invalid && (
              <span className="text-xs text-emerald-700">Saved</span>
            )}
          </div>

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
