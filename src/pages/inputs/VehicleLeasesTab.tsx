import { useCallback, useEffect, useState } from 'react';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import VehicleLeaseForm, {
  DEFAULT_VEHICLE_LEASE,
} from '@/components/forms/VehicleLeaseForm';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function VehicleLeasesTab() {
  const { vehicleLeases, load, create, update, remove, isLoading, error } = useVehicleLeasesStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
  }, [load, loadPersons]);
  const gate = useLoadGate([isLoading], [error], reload);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!vehicleLeases.some((l) => l.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, vehicleLeases]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add vehicle lease</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Recurring monthly lease payment for a vehicle you don't own.
        </p>
        <VehicleLeaseForm
          initial={DEFAULT_VEHICLE_LEASE}
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
    const target = vehicleLeases.find((l) => l.id === mode.id);
    if (!target) return null;
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit vehicle lease</h2>
        <VehicleLeaseForm
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
      <h2 className="text-2xl font-semibold mb-1">Vehicle leases</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Recurring monthly lease payments. These add to your monthly obligations
        on the Vehicles page and the What-If projection.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : vehicleLeases.length === 0 ? (
        error == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            No vehicle leases added yet.
          </div>
        ) : null
      ) : (
        <div className="space-y-2">
          {vehicleLeases.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {currencyFormatter.format(l.monthlyAmount)}/mo
                    {' · '}from {l.startDate}
                    {l.endDate ? ` to ${l.endDate}` : ' (ongoing)'}
                    {' · '}
                    {l.ownerPersonId == null
                      ? 'Joint'
                      : (personById.get(l.ownerPersonId) ?? 'Unknown')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMode({ type: 'edit', id: l.id! })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${l.name}?`,
                        description: 'This permanently removes this lease. This can’t be undone.',
                      });
                      if (ok) await remove(l.id!);
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
        <Button onClick={() => setMode('create')}>Add Lease</Button>
      </div>
      {dialog}
    </div>
  );
}
