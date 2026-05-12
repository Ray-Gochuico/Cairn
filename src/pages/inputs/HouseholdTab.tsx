import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useHouseholdStore } from '@/stores/household-store';
import { HouseholdSchema, type Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

type FormValues = Omit<Household, 'id'>;

const DEFAULT_VALUES: FormValues = {
  name: null,
  filingStatus: FilingStatus.SINGLE,
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 0,
  withdrawalRate: 0.04,
  inflationAssumption: 0.024,
  growthScenarios: [
    { label: 'Conservative', rate: 0.05 },
    { label: 'Moderate', rate: 0.06 },
    { label: 'Optimistic', rate: 0.07 },
    { label: 'Bull', rate: 0.08 },
  ],
};

export default function HouseholdTab() {
  const { household, load, update, isLoading, error } = useHouseholdStore();

  const values = useMemo<FormValues | undefined>(() => {
    if (!household) return undefined;
    return {
      name: household.name ?? null,
      filingStatus: household.filingStatus,
      state: household.state,
      city: household.city,
      monthlyExpenseBaseline: household.monthlyExpenseBaseline,
      withdrawalRate: household.withdrawalRate,
      inflationAssumption: household.inflationAssumption,
      growthScenarios: household.growthScenarios,
    };
  }, [household]);

  const form = useForm<FormValues>({
    resolver: zodResolver(HouseholdSchema.omit({ id: true })),
    defaultValues: DEFAULT_VALUES,
    values,
  });

  useEffect(() => {
    load().catch((e) => console.error('HouseholdTab: load() failed', e));
  }, [load]);

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const onSubmit = async (values: FormValues) => {
    try {
      await update(values);
      setJustSaved(true);
    } catch (e) {
      console.error('[HouseholdTab] save failed', e);
    }
  };

  const onInvalid = (errors: Record<string, unknown>) => {
    console.warn('[HouseholdTab] form validation failed', errors);
  };

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  const dirty = form.formState.isDirty;

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-semibold mb-1">Household</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Settings shared across the household — filing status, location, expense baseline, and assumptions used by every calculator.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Identity &amp; tax</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="name">Household name (optional)</Label>
              <Input
                id="name"
                {...form.register('name', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>

            <div>
              <Label htmlFor="filingStatus">Filing status</Label>
              <Select
                value={form.watch('filingStatus')}
                onValueChange={(v) =>
                  form.setValue('filingStatus', v as FilingStatus, {
                    shouldDirty: true,
                    shouldTouch: true,
                  })
                }
              >
                <SelectTrigger id="filingStatus"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={FilingStatus.SINGLE}>Single</SelectItem>
                  <SelectItem value={FilingStatus.MFJ}>Married Filing Jointly</SelectItem>
                  <SelectItem value={FilingStatus.MFS}>Married Filing Separately</SelectItem>
                  <SelectItem value={FilingStatus.HOH}>Head of Household</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  maxLength={2}
                  list="us-states"
                  {...form.register('state', {
                    setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                  })}
                  placeholder="CA"
                />
                <datalist id="us-states">
                  {US_STATES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="city">City (only if it has local income tax)</Label>
                <Input
                  id="city"
                  {...form.register('city', { setValueAs: (v) => (v === '' ? null : v) })}
                  placeholder="e.g. NYC"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Assumptions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="monthlyExpenseBaseline">Monthly expense baseline ($)</Label>
              <Input
                id="monthlyExpenseBaseline"
                type="number"
                step="any"
                {...form.register('monthlyExpenseBaseline', { valueAsNumber: true })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="withdrawalRate">Withdrawal rate (e.g. 0.04 = 4% rule)</Label>
                <Input
                  id="withdrawalRate"
                  type="number"
                  step="0.001"
                  {...form.register('withdrawalRate', { valueAsNumber: true })}
                />
              </div>
              <div>
                <Label htmlFor="inflationAssumption">Inflation assumption</Label>
                <Input
                  id="inflationAssumption"
                  type="number"
                  step="0.001"
                  {...form.register('inflationAssumption', { valueAsNumber: true })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {fieldErrors.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
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

        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        <div className="flex justify-end items-center gap-3">
          <span
            className="text-sm text-muted-foreground transition-opacity duration-200"
            style={{ opacity: isLoading || justSaved ? 1 : 0 }}
            aria-live="polite"
          >
            {isLoading ? 'Saving…' : justSaved ? 'Saved' : ''}
          </span>
          <Button type="submit" disabled={isLoading || !dirty}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
