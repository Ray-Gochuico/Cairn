import { useEffect, useState } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PersonForm, { DEFAULT_PERSON } from '@/components/forms/PersonForm';

export default function PersonsTab() {
  const { persons, load, create, update, remove } = usePersonsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!persons.some((p) => p.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, persons]);

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add person</h2>
        <p className="text-sm text-muted-foreground mb-4">Up to 2 persons supported per household.</p>
        <PersonForm
          initial={DEFAULT_PERSON}
          onSubmit={async (v) => {
            await create(v);
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = persons.find((p) => p.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
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
            expectedBonusFrequency: target.expectedBonusFrequency,
            bonusIsConsistent: target.bonusIsConsistent,
            expectedCommission: target.expectedCommission,
            expectedCommissionFrequency: target.expectedCommissionFrequency,
            employmentType: target.employmentType,
            hourlyRate: target.hourlyRate,
            regularHoursPerWeek: target.regularHoursPerWeek,
            otThresholdHoursPerWeek: target.otThresholdHoursPerWeek,
            pretax401kPct: target.pretax401kPct,
            healthInsuranceMonthlyPremium: target.healthInsuranceMonthlyPremium,
            dependentCareFsaMonthly: target.dependentCareFsaMonthly,
            hsaMonthlyContribution: target.hsaMonthlyContribution,
            hsaEligible: target.hsaEligible,
          }}
          onSubmit={async (v) => {
            await update(mode.id, v);
            setMode('list');
          }}
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
