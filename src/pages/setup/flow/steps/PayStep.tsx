import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FieldError } from '@/components/forms/form-errors';
import type { EmploymentType } from '@/types/schema';
import type { EmploymentDraft } from '@/lib/employment-fields';
import { nameForRole, prefillPay, savePay } from '@/domain/setup-flow/steps/part2';
import type { StepComponentProps } from '../step-props';

const emptyToNullNumber = (v: string): number | null => {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 2a — CW-24/25/26. Saves through the ONE employment contract; unbound
 *  saves park as a pay draft (deferred creation). */
export default function PayStep({ ctx, role = 'you', asked, onDirtyChange, submitRef }: StepComponentProps) {
  const name = nameForRole(ctx, role);
  const [seed] = useState<EmploymentDraft | null>(() => (asked ? prefillPay(ctx, role) : null));
  // The pay-type radiogroup starts unanswered on a never-asked step; fields
  // reveal from the chosen type (D-W3 conditional reveal).
  const [payType, setPayType] = useState<EmploymentType | null>(seed?.employmentType ?? null);
  const [salary, setSalary] = useState(seed?.annualSalaryPretax ?? '');
  const [hourlyRate, setHourlyRate] = useState<number | null>(seed?.hourlyRate ?? null);
  const [hours, setHours] = useState(seed?.regularHoursPerWeek ?? '40');
  const [otThreshold, setOtThreshold] = useState<number | null>(seed?.otThresholdHoursPerWeek ?? null);
  const [typeError, setTypeError] = useState(false);
  const [salaryError, setSalaryError] = useState(false);
  const [hourlyError, setHourlyError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const showSalary = payType === 'SALARY_NO_OT' || payType === 'SALARY_WITH_OT';
  const showHourly = payType === 'HOURLY' || payType === 'SALARY_WITH_OT';

  useEffect(() => {
    const dirty =
      payType !== (seed?.employmentType ?? null) ||
      salary !== (seed?.annualSalaryPretax ?? '') ||
      hourlyRate !== (seed?.hourlyRate ?? null) ||
      hours !== (seed?.regularHoursPerWeek ?? '40') ||
      otThreshold !== (seed?.otThresholdHoursPerWeek ?? null);
    onDirtyChange(dirty);
  }, [payType, salary, hourlyRate, hours, otThreshold, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      if (payType == null) {
        setTypeError(true);
        return { ok: false };
      }
      setTypeError(false);
      const draft: EmploymentDraft = {
        employmentType: payType,
        annualSalaryPretax: salary,
        hourlyRate,
        regularHoursPerWeek: hours,
        otThresholdHoursPerWeek: otThreshold,
      };
      try {
        setSaveError(false);
        const r = await savePay(role, draft, ctx);
        if (!r.ok) {
          const salaryMissing = payType !== 'HOURLY' && salary.trim() === '';
          const hourlyMissing =
            payType !== 'SALARY_NO_OT' && (hourlyRate == null || hours.trim() === '');
          setSalaryError(salaryMissing);
          setHourlyError(hourlyMissing);
        } else {
          setSalaryError(false);
          setHourlyError(false);
        }
        return r;
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-3">
      <p className="text-base font-medium" id="flow-pay-q">
        How is {name} paid?
      </p>
      <RadioGroup
        aria-labelledby="flow-pay-q"
        value={
          payType === 'HOURLY' ? 'hourly'
          : payType === 'SALARY_NO_OT' ? 'salary'
          : payType === 'SALARY_WITH_OT' ? 'salary_ot'
          : ''
        }
        onValueChange={(v) =>
          setPayType(v === 'hourly' ? 'HOURLY' : v === 'salary' ? 'SALARY_NO_OT' : 'SALARY_WITH_OT')
        }
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="hourly" id="flow-pay-hourly" />
          <Label htmlFor="flow-pay-hourly">Hourly</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="salary" id="flow-pay-salary" />
          <Label htmlFor="flow-pay-salary">Salary</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="salary_ot" id="flow-pay-salary-ot" />
          <Label htmlFor="flow-pay-salary-ot">Salary with overtime</Label>
        </div>
      </RadioGroup>
      {typeError && (
        <FieldError id="flow-pay-type-error" message="An answer is required." />
      )}
      {payType === 'HOURLY' && (
        <p className="text-sm text-muted-foreground">
          {name}'s hourly pay is saved, but the Paycheck estimate only covers salaries today
          — the Overtime calculator covers hourly take-home.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {showSalary && (
          <div>
            <Label htmlFor="flow-pay-annual">Annual salary (pre-tax)</Label>
            <Input
              id="flow-pay-annual"
              type="number"
              step="any"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              aria-invalid={salaryError ? true : undefined}
              aria-describedby={salaryError ? 'flow-pay-annual-error' : undefined}
            />
            <FieldError
              id="flow-pay-annual-error"
              message={salaryError ? 'Annual salary is required.' : undefined}
            />
          </div>
        )}
        {showHourly && (
          <>
            <div>
              <Label htmlFor="flow-pay-rate">Hourly rate</Label>
              <Input
                id="flow-pay-rate"
                type="number"
                step="any"
                value={hourlyRate ?? ''}
                onChange={(e) => setHourlyRate(emptyToNullNumber(e.target.value))}
                aria-invalid={hourlyError ? true : undefined}
                aria-describedby={hourlyError ? 'flow-pay-hourly-error' : undefined}
              />
            </div>
            <div>
              <Label htmlFor="flow-pay-hours">Regular hours / week</Label>
              <Input
                id="flow-pay-hours"
                type="number"
                step="any"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={hourlyError ? true : undefined}
                aria-describedby={hourlyError ? 'flow-pay-hourly-error' : undefined}
              />
              <FieldError
                id="flow-pay-hourly-error"
                message={hourlyError ? 'Hourly rate and regular hours are required.' : undefined}
              />
            </div>
            <div>
              <Label htmlFor="flow-pay-ot">OT threshold (hrs / week) — optional</Label>
              <Input
                id="flow-pay-ot"
                type="number"
                step="any"
                value={otThreshold ?? ''}
                onChange={(e) => setOtThreshold(emptyToNullNumber(e.target.value))}
              />
            </div>
          </>
        )}
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
