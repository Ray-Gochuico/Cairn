import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  PersonSchema,
  EmploymentTypeSchema,
  BonusFrequencySchema,
  type Person,
} from '@/types/schema';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// PersonFormValues mirrors Person but drops the DB-only id and the
// roadmap rule-engine chart-answer columns (those are written by
// roadmap decision nodes, not by the person edit form).
export type PersonFormValues = Omit<
  Person,
  | 'id'
  | 'jobStability'
  | 'expectsHigherFutureIncome'
  | 'onParentHealthInsurance'
  | 'isRelativelyHealthy'
>;

export const DEFAULT_PERSON: PersonFormValues = {
  householdId: 1,
  name: '',
  dateOfBirth: '',
  targetRetirementAge: 65,
  annualSalaryPretax: 0,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: null,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

export interface PersonFormProps {
  initial: PersonFormValues;
  onSubmit: (values: PersonFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

// Empty input → null for nullable numeric fields (hourlyRate,
// otThresholdHoursPerWeek). RHF's `valueAsNumber: true` coerces empty
// strings to NaN, which fails Zod's `.positive().nullable()` refinement.
const emptyToNullNumber = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// Form-shaped schema. PersonSchema has `.default(...)` on several
// fields, which makes Zod's *input* type partial (those keys become
// optional). RHF derives its resolver type from the schema's input
// type, so the result is a Resolver<Partial<...>> that doesn't line up
// with our strict `PersonFormValues` (= Omit<Person, 'id'>). We rebuild
// without the defaults so input and output coincide. DEFAULT_PERSON
// already provides equivalent runtime defaults for new persons.
const PersonFormSchema = PersonSchema.omit({
  id: true,
  jobStability: true,
  expectsHigherFutureIncome: true,
  onParentHealthInsurance: true,
  isRelativelyHealthy: true,
}).extend({
  expectedBonus: z.number().min(0),
  expectedBonusFrequency: BonusFrequencySchema,
  bonusIsConsistent: z.boolean(),
  employmentType: EmploymentTypeSchema,
  hourlyRate: z.number().positive().nullable(),
  regularHoursPerWeek: z.number().positive(),
  otThresholdHoursPerWeek: z.number().positive().nullable(),
});

/**
 * Standalone person form. Used by both the PersonsTab create/edit
 * flow and the SetupWizard Step 2 onboarding flow. Caller owns the
 * submit handler and the cancel-vs-skip semantics; this component
 * just owns RHF state, validation, and the field layout.
 */
export default function PersonForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: PersonFormProps) {
  const form = useForm<PersonFormValues>({
    resolver: zodResolver(PersonFormSchema),
    defaultValues: initial,
  });

  const employmentType = form.watch('employmentType');
  const showHourlyFields = employmentType !== 'SALARY_NO_OT';
  const showAnnualSalary = employmentType !== 'HOURLY';

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Person details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} />
            </div>
            <div>
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <DatePicker
                id="dateOfBirth"
                value={form.watch('dateOfBirth')}
                onChange={(v) =>
                  form.setValue('dateOfBirth', v, { shouldDirty: true, shouldTouch: true })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="targetRetirementAge">Target retirement age</Label>
              <Input
                id="targetRetirementAge"
                type="number"
                {...form.register('targetRetirementAge', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="employmentType">Employment type</Label>
              <select
                id="employmentType"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('employmentType')}
              >
                <option value="HOURLY">Hourly</option>
                <option value="SALARY_NO_OT">Salaried — no overtime</option>
                <option value="SALARY_WITH_OT">Salaried with overtime</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showAnnualSalary && (
              <div>
                <Label htmlFor="annualSalaryPretax">Annual salary (pre-tax)</Label>
                <Input
                  id="annualSalaryPretax"
                  type="number"
                  step="any"
                  {...form.register('annualSalaryPretax', { valueAsNumber: true })}
                />
              </div>
            )}
            {showHourlyFields && (
              <>
                <div>
                  <Label htmlFor="hourlyRate">Hourly rate</Label>
                  <Input
                    id="hourlyRate"
                    type="number"
                    step="any"
                    {...form.register('hourlyRate', { setValueAs: emptyToNullNumber })}
                  />
                </div>
                <div>
                  <Label htmlFor="regularHoursPerWeek">Regular hours / week</Label>
                  <Input
                    id="regularHoursPerWeek"
                    type="number"
                    step="any"
                    {...form.register('regularHoursPerWeek', { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <Label htmlFor="otThresholdHoursPerWeek">OT threshold (hrs / week)</Label>
                  <Input
                    id="otThresholdHoursPerWeek"
                    type="number"
                    step="any"
                    {...form.register('otThresholdHoursPerWeek', { setValueAs: emptyToNullNumber })}
                  />
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="expectedCommission">Expected commission (annual)</Label>
              <Input
                id="expectedCommission"
                type="number"
                step="any"
                {...form.register('expectedCommission', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="expectedCommissionFrequency">Commission paid</Label>
              <select
                id="expectedCommissionFrequency"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('expectedCommissionFrequency')}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="expectedBonus">Expected bonus (annual)</Label>
              <Input
                id="expectedBonus"
                type="number"
                step="any"
                {...form.register('expectedBonus', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="expectedBonusFrequency">Bonus frequency</Label>
              <select
                id="expectedBonusFrequency"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register('expectedBonusFrequency')}
              >
                <option value="ANNUAL">Annual</option>
                <option value="QUARTERLY">Quarterly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...form.register('bonusIsConsistent')}
              />
              Bonuses are consistent year over year
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pretax401kPct">Pre-tax 401k contribution (e.g. 0.10 = 10%)</Label>
              <Input
                id="pretax401kPct"
                type="number"
                step="0.01"
                {...form.register('pretax401kPct', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="healthInsuranceMonthlyPremium">Health ins. premium /mo</Label>
              <Input
                id="healthInsuranceMonthlyPremium"
                type="number"
                step="any"
                {...form.register('healthInsuranceMonthlyPremium', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="dependentCareFsaMonthly">DCFSA /mo</Label>
              <Input
                id="dependentCareFsaMonthly"
                type="number"
                step="any"
                {...form.register('dependentCareFsaMonthly', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="hsaMonthlyContribution">HSA /mo</Label>
              <Input
                id="hsaMonthlyContribution"
                type="number"
                step="any"
                {...form.register('hsaMonthlyContribution', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...form.register('hsaEligible')}
              />
              HSA eligible (on a HDHP plan)
            </label>
          </div>
        </CardContent>
      </Card>

      {fieldErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
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

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
