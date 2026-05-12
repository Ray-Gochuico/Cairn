import { useEffect, useState } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import LoanForm, { DEFAULT_LOAN, LOAN_TYPE_LABELS } from '@/components/forms/LoanForm';

export default function LoansTab() {
  const { loans, load, create, update, remove } = useLoansStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { properties, load: loadProperties } = usePropertiesStore();
  const { vehicles, load: loadVehicles } = useVehiclesStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
    loadProperties();
    loadVehicles();
  }, [load, loadPersons, loadProperties, loadVehicles]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!loans.some((l) => l.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, loans]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const propertyOptions = properties.map((p) => ({ id: p.id!, name: p.name }));
  const vehicleOptions = vehicles.map((v) => ({ id: v.id!, name: v.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add loan</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Mortgages, auto loans, student loans, credit cards, and other debts.
        </p>
        <LoanForm
          initial={DEFAULT_LOAN}
          persons={personOptions}
          properties={propertyOptions}
          vehicles={vehicleOptions}
          initialMonthlyPaymentIsUserSet={false}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = loans.find((l) => l.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit loan</h2>
        <LoanForm
          initial={{
            householdId: target.householdId,
            obligorPersonId: target.obligorPersonId,
            name: target.name,
            type: target.type,
            originalAmount: target.originalAmount,
            currentBalance: target.currentBalance,
            interestRate: target.interestRate,
            termMonths: target.termMonths,
            firstPaymentDate: target.firstPaymentDate,
            monthlyPayment: target.monthlyPayment,
            extraPaymentDefault: target.extraPaymentDefault,
            linkedPropertyId: target.linkedPropertyId,
            linkedVehicleId: target.linkedVehicleId,
          }}
          persons={personOptions}
          properties={propertyOptions}
          vehicles={vehicleOptions}
          initialMonthlyPaymentIsUserSet={target.monthlyPayment > 0}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Loans</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Every loan you carry — mortgage, auto, student, credit card, or other.
      </p>

      {loans.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No loans added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {loans.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {LOAN_TYPE_LABELS[l.type]}
                    {' · '}
                    ${l.currentBalance.toLocaleString()} balance
                    {' · '}
                    {l.obligorPersonId == null
                      ? 'Joint'
                      : personById.get(l.obligorPersonId) ?? 'Unknown obligor'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: l.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(l.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Loan</Button>
      </div>
    </div>
  );
}
