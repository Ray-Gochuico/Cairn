import { useCallback, useEffect, useState } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import PersonForm, { DEFAULT_PERSON } from '@/components/forms/PersonForm';

export default function PersonsTab() {
  const { persons, load, create, update, remove, isLoading, error } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
  }, [load]);
  const gate = useLoadGate([isLoading], [error], reload);

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

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : persons.length === 0 ? (
        error == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            No persons added yet.
          </div>
        ) : null
      ) : (
        <div className="space-y-2">
          {persons.map((p) => (
            <Card key={p.id} data-testid="persons-row">
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    DOB: {p.dateOfBirth} · Retire at {p.targetRetirementAge} · Salary ${p.annualSalaryPretax.toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: p.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${p.name}?`,
                        description:
                          'This permanently deletes their equity grants, and unlinks them from any accounts, loans, properties, vehicles, goals, rent/housing payments, leases, and transactions they’re tied to. This can’t be undone.',
                      });
                      if (ok) await remove(p.id!);
                    }}
                  >
                    Delete
                  </Button>
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
      {dialog}
    </div>
  );
}
