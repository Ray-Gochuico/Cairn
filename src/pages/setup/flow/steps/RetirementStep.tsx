import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/forms/form-errors';
import { nameForRole, personForRole, saveRetirement } from '@/domain/setup-flow/steps/part2';
import type { StepComponentProps } from '../step-props';

/** 2b — CW-27. The unbound save is THE one-shot person create (D-WF2). */
export default function RetirementStep({ ctx, role = 'you', onDirtyChange, submitRef }: StepComponentProps) {
  const name = nameForRole(ctx, role);
  // Review M5 (D-W4): a bound person's saved age prefills regardless of the
  // asked flag — Settings → Revisit setup opens with progress cleared.
  const [seed] = useState<string>(() => {
    const bound = personForRole(ctx, role);
    return bound ? String(bound.targetRetirementAge) : '';
  });
  const [age, setAge] = useState(seed);
  const [ageError, setAgeError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    onDirtyChange(age !== seed);
  }, [age, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      try {
        setSaveError(false);
        const r = await saveRetirement(role, Number(age), ctx);
        setAgeError(!r.ok);
        return r;
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-3">
      <p className="text-base font-medium">When does {name} plan to retire?</p>
      <div>
        <Label htmlFor="flow-retirement-age">Target retirement age</Label>
        <Input
          id="flow-retirement-age"
          type="number"
          min={30}
          max={90}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          aria-invalid={ageError ? true : undefined}
          aria-describedby={ageError ? 'flow-retirement-age-error' : 'flow-retirement-age-hint'}
        />
        <p id="flow-retirement-age-hint" className="text-xs text-muted-foreground mt-1">
          An age from 30 to 90.
        </p>
        <FieldError
          id="flow-retirement-age-error"
          message={ageError ? 'An age from 30 to 90.' : undefined}
        />
      </div>
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
