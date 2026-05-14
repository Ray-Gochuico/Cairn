import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PersonSchema, type Person } from '@/types/schema';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// PersonFormValues omits fields not yet surfaced in the form UI (expectedBonus is
// deprecated; the employment-type and bonus-frequency fields are introduced in
// migration 0005 and will be surfaced by tasks 12.6.2–12.6.7). Callers inject
// safe defaults when converting PersonFormValues back to a full Person for
// persistence (see PersonsTab.tsx, Step2Persons.tsx).
export type PersonFormValues = Omit<
  Person,
  | 'id'
  | 'expectedBonus'
  | 'expectedBonusFrequency'
  | 'bonusIsConsistent'
  | 'employmentType'
  | 'hourlyRate'
  | 'regularHoursPerWeek'
  | 'otThresholdHoursPerWeek'
>;

export const DEFAULT_PERSON: PersonFormValues = {
  householdId: 1,
  name: '',
  dateOfBirth: '',
  targetRetirementAge: 65,
  annualSalaryPretax: 0,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
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
    resolver: zodResolver(
      PersonSchema.omit({
        id: true,
        expectedBonus: true,
        expectedBonusFrequency: true,
        bonusIsConsistent: true,
        employmentType: true,
        hourlyRate: true,
        regularHoursPerWeek: true,
        otThresholdHoursPerWeek: true,
      }),
    ),
    defaultValues: initial,
  });

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
              <Label htmlFor="annualSalaryPretax">Annual salary (pre-tax)</Label>
              <Input
                id="annualSalaryPretax"
                type="number"
                step="any"
                {...form.register('annualSalaryPretax', { valueAsNumber: true })}
              />
            </div>
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
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
