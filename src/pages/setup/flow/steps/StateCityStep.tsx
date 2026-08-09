import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/forms/form-errors';
import { prettifyCityCode, US_STATES } from '@/lib/jurisdiction-format';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { prefillStateCity, saveStateCity } from '@/domain/setup-flow/steps/part1';
import { isSetupDismissed } from '@/lib/setup-dismissal';
import type { StepComponentProps } from '../step-props';

/** 1c — CW-20. City select appears only for states with seeded CITY rules;
 *  a mismatched city auto-clears (HouseholdForm parity). Store STATE read
 *  only — loadYear belongs to the shell's hydration block. */
export default function StateCityStep({ ctx, asked, onDirtyChange, submitRef }: StepComponentProps) {
  // Review M5 (D-W4): post-finish, Revisit setup prefills the household cells.
  const [seed] = useState(() =>
    asked || isSetupDismissed() ? prefillStateCity(ctx) : { state: null, city: null },
  );
  const [state, setState] = useState<string | null>(seed.state);
  const [city, setCity] = useState<string | null>(seed.city);
  const [stateError, setStateError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const taxRulesItems = useTaxRulesStore((s) => s.items);
  const cityRules =
    state == null
      ? []
      : taxRulesItems.filter(
          (r) =>
            r.jurisdictionType === 'CITY' &&
            r.filingStatus === 'SINGLE' &&
            r.jurisdictionCode.startsWith(`${state}_`),
        );

  useEffect(() => {
    onDirtyChange(state !== seed.state || city !== seed.city);
  }, [state, city, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      const invalid = state == null || state.length !== 2;
      setStateError(invalid);
      if (invalid) return { ok: false };
      try {
        setSaveError(false);
        return await saveStateCity({ state, city }, ctx);
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="flow-state">Which state do you live in?</Label>
        <Input
          id="flow-state"
          maxLength={2}
          list="flow-us-states"
          placeholder="CA"
          value={state ?? ''}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setState(next === '' ? null : next);
            // Mismatched city clears immediately (HouseholdForm parity).
            if (city != null && !city.startsWith(`${next}_`)) setCity(null);
          }}
          aria-invalid={stateError ? true : undefined}
          aria-describedby={stateError ? 'flow-state-error' : undefined}
        />
        <FieldError
          id="flow-state-error"
          message={stateError ? 'A two-letter state is required.' : undefined}
        />
        <datalist id="flow-us-states">
          {US_STATES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      {cityRules.length > 0 && (
        <div>
          <Label htmlFor="flow-city">City income tax</Label>
          <select
            id="flow-city"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={city ?? ''}
            onChange={(e) => setCity(e.target.value === '' ? null : e.target.value)}
            aria-describedby="flow-city-hint"
          >
            <option value="">(No local tax)</option>
            {cityRules.map((r) => (
              <option key={r.jurisdictionCode} value={r.jurisdictionCode}>
                {prettifyCityCode(r.jurisdictionCode)}
              </option>
            ))}
          </select>
          <p id="flow-city-hint" className="text-xs text-muted-foreground mt-1">
            Only cities with a local income tax are listed.
          </p>
        </div>
      )}
      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
        >
          Couldn't save — please check the values.
        </div>
      )}
    </div>
  );
}
