import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonSchema, type Person } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FormValues = Omit<Person, 'id'>;

const DEFAULT_PERSON: FormValues = {
  householdId: 1,
  name: '',
  dateOfBirth: '',
  targetRetirementAge: 65,
  annualSalaryPretax: 0,
  expectedBonus: 0,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

function PersonForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(PersonSchema.omit({ id: true })),
    defaultValues: initial,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Person details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} />
            </div>
            <div>
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <Input id="dateOfBirth" type="date" {...form.register('dateOfBirth')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="expectedBonus">Expected bonus ($)</Label>
              <Input
                id="expectedBonus"
                type="number"
                step="any"
                {...form.register('expectedBonus', { valueAsNumber: true })}
              />
            </div>
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

          <div className="grid grid-cols-3 gap-3">
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

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

export default function PersonsTab() {
  const { persons, load, create, update, remove } = usePersonsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
  }, [load]);

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add person</h2>
        <p className="text-sm text-muted-foreground mb-4">Up to 2 persons supported per household.</p>
        <PersonForm
          initial={DEFAULT_PERSON}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = persons.find((p) => p.id === mode.id);
    if (!target) {
      setMode('list');
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit person</h2>
        <PersonForm
          initial={{
            householdId: target.householdId,
            name: target.name,
            dateOfBirth: target.dateOfBirth,
            targetRetirementAge: target.targetRetirementAge,
            annualSalaryPretax: target.annualSalaryPretax,
            expectedBonus: target.expectedBonus,
            pretax401kPct: target.pretax401kPct,
            healthInsuranceMonthlyPremium: target.healthInsuranceMonthlyPremium,
            dependentCareFsaMonthly: target.dependentCareFsaMonthly,
            hsaMonthlyContribution: target.hsaMonthlyContribution,
            hsaEligible: target.hsaEligible,
          }}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Persons</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Add yourself and your spouse/partner (up to 2). Used for income, retirement age, and per-person calculators.
      </p>

      {persons.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No persons added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {persons.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    DOB: {p.dateOfBirth} · Retire at {p.targetRetirementAge} · Salary ${p.annualSalaryPretax.toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: p.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(p.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')} disabled={persons.length >= 2}>
          {persons.length >= 2 ? 'Maximum of 2 persons reached' : 'Add Person'}
        </Button>
      </div>
    </div>
  );
}
