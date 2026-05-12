import { useEffect, useState } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import LoanForm, { DEFAULT_LOAN, LOAN_TYPE_LABELS } from '@/components/forms/LoanForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 6 — Loans. Multi-instance, optional. Properties and
 * vehicles haven't been created yet at this point in the wizard, so the
 * linked-property / linked-vehicle pickers will be empty here; users can
 * link after-the-fact from the Inputs page once everything exists.
 */
export default function Step6Loans({ onComplete }: Props) {
  const { loans, load, create, remove } = useLoansStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { properties, load: loadProperties } = usePropertiesStore();
  const { vehicles, load: loadVehicles } = useVehiclesStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
    loadPersons();
    loadProperties();
    loadVehicles();
  }, [load, loadPersons, loadProperties, loadVehicles]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const propertyOptions = properties.map((p) => ({ id: p.id!, name: p.name }));
  const vehicleOptions = vehicles.map((v) => ({ id: v.id!, name: v.name }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Loans</h2>
        <p className="text-sm text-muted-foreground">
          Add your mortgages, auto loans, student loans, credit cards, and any other debts. You can always add more later.
        </p>
      </div>

      {loans.length > 0 && (
        <div className="space-y-2">
          {loans.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {LOAN_TYPE_LABELS[l.type]} · ${l.currentBalance.toLocaleString()} balance
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => remove(l.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <LoanForm
          initial={DEFAULT_LOAN}
          persons={personOptions}
          properties={propertyOptions}
          vehicles={vehicleOptions}
          initialMonthlyPaymentIsUserSet={false}
          onSubmit={async (v) => {
            await create(v);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
          submitLabel="Add Loan"
        />
      )}

      {!showForm && (
        <div>
          <Button variant="outline" onClick={() => setShowForm(true)}>
            {loans.length === 0 ? 'Add a loan' : 'Add another loan'}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onComplete}>Continue</Button>
        {loans.length === 0 && (
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip — no loans
          </Button>
        )}
      </div>
    </div>
  );
}
