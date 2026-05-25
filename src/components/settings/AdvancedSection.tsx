import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useHouseholdStore } from '@/stores/household-store';
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
 *   2. Reset disclaimer acceptances — opens ResetDisclaimersDialog.
 *      Useful for QA/testing; not destructive (audit log is preserved).
 *
 * Future additions go inside this card: tax year override, MAGI
 * tuning, stable/unstable threshold overrides. Keeping them gated
 * behind the disclosure keeps the rest of Settings approachable.
 */
export function AdvancedSection() {
  const household = useHouseholdStore((s) => s.household);
  const load = useHouseholdStore((s) => s.load);
  const update = useHouseholdStore((s) => s.update);

  const [open, setOpen] = useState(false);
  const [low, setLow] = useState<string>('');
  const [high, setHigh] = useState<string>('');
  const [resetOpen, setResetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

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

  const lowNum = low.trim() === '' ? null : Number(low);
  const highNum = high.trim() === '' ? null : Number(high);
  const lowInvalid = lowNum !== null && (Number.isNaN(lowNum) || lowNum < 0 || lowNum > 100);
  const highInvalid = highNum !== null && (Number.isNaN(highNum) || highNum < 0 || highNum > 100);
  const orderInvalid = lowNum !== null && highNum !== null && lowNum >= highNum;
  const invalid = lowInvalid || highInvalid || orderInvalid;

  const handleSave = async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    try {
      await update({
        interestThresholdLowPct: lowNum,
        interestThresholdHighPct: highNum,
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
              <Button
                onClick={handleSave}
                disabled={invalid || submitting}
              >
                Save
              </Button>
              {savedAt && !invalid && (
                <span className="text-xs text-emerald-700">Saved</span>
              )}
            </div>
            {invalid && (
              <div className="text-xs text-red-700 mt-2" role="alert">
                {orderInvalid
                  ? 'Low cutoff must be less than high cutoff.'
                  : 'Both cutoffs must be between 0 and 100.'}
              </div>
            )}
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
