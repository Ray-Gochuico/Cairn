import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/ui/DatePicker';
import { FieldError } from '@/components/forms/form-errors';
import { prefillAboutYou, saveAboutYou } from '@/domain/setup-flow/steps/part1';
import type { StepComponentProps } from '../step-props';

/** 1a — CW-10. Deferred creation: the save drafts name+DOB, no person row. */
export default function AboutYouStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const [seed] = useState(() => prefillAboutYou(ctx));
  const [name, setName] = useState(seed.name);
  const [dateOfBirth, setDateOfBirth] = useState(seed.dateOfBirth);
  const [nameError, setNameError] = useState(false);
  const [dobError, setDobError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    onDirtyChange(name !== seed.name || dateOfBirth !== seed.dateOfBirth);
  }, [name, dateOfBirth, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      const missingName = name.trim() === '';
      const missingDob = dateOfBirth === '';
      setNameError(missingName);
      setDobError(missingDob);
      if (missingName || missingDob) return { ok: false };
      try {
        setSaveError(false);
        return await saveAboutYou({ name, dateOfBirth }, ctx);
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-base">Let's start with you.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="flow-your-name">Your name</Label>
          <Input
            id="flow-your-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'flow-your-name-error' : undefined}
          />
          <FieldError
            id="flow-your-name-error"
            message={nameError ? 'Name is required.' : undefined}
          />
        </div>
        <div>
          <Label htmlFor="flow-your-dob">Your date of birth</Label>
          <DatePicker
            id="flow-your-dob"
            label="Your date of birth"
            value={dateOfBirth}
            onChange={setDateOfBirth}
            maxYear={new Date().getFullYear() - 16}
            ariaInvalid={dobError}
            ariaDescribedBy={dobError ? 'flow-your-dob-error' : undefined}
          />
          <FieldError
            id="flow-your-dob-error"
            message={dobError ? 'Date of birth is required.' : undefined}
          />
        </div>
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
