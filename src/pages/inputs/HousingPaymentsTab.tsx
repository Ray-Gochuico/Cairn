import { useEffect, useState } from 'react';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import HousingPaymentForm, {
  DEFAULT_HOUSING_PAYMENT,
} from '@/components/forms/HousingPaymentForm';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function HousingPaymentsTab() {
  const { housingPayments, load, create, update, remove } = useHousingPaymentsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
  }, [load, loadPersons]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!housingPayments.some((p) => p.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, housingPayments]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add rent / housing payment</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Recurring monthly rent if you don't own your home.
        </p>
        <HousingPaymentForm
          initial={DEFAULT_HOUSING_PAYMENT}
          persons={personOptions}
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
    const target = housingPayments.find((p) => p.id === mode.id);
    if (!target) return null;
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit rent / housing payment</h2>
        <HousingPaymentForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            monthlyAmount: target.monthlyAmount,
            startDate: target.startDate,
            endDate: target.endDate,
          }}
          persons={personOptions}
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
      <h2 className="text-2xl font-semibold mb-1">Rent / housing payments</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Recurring monthly rent. These add to your monthly obligations on the
        Home page and the What-If projection.
      </p>

      {housingPayments.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No rent/housing payments added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {housingPayments.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {currencyFormatter.format(p.monthlyAmount)}/mo
                    {' · '}from {p.startDate}
                    {p.endDate ? ` to ${p.endDate}` : ' (ongoing)'}
                    {' · '}
                    {p.ownerPersonId == null
                      ? 'Joint'
                      : (personById.get(p.ownerPersonId) ?? 'Unknown')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMode({ type: 'edit', id: p.id! })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this rent/housing payment?',
                        description: 'This permanently removes the payment record. This can’t be undone.',
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
        <Button onClick={() => setMode('create')}>Add Rent/Housing Payment</Button>
      </div>
      {dialog}
    </div>
  );
}
