import { useCallback, useEffect, useState } from 'react';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import VehicleForm, { DEFAULT_VEHICLE } from '@/components/forms/VehicleForm';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';

export default function VehiclesTab() {
  const { vehicles, load, create, update, remove, isLoading, error } = useVehiclesStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
    loadLoans();
  }, [load, loadPersons, loadLoans]);
  const gate = useLoadGate([isLoading], [error], reload);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!vehicles.some((v) => v.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, vehicles]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const autoLoanOptions = loans
    .filter((l) => l.type === LoanType.AUTO)
    .map((l) => ({ id: l.id!, name: l.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add vehicle</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Cars, trucks, motorcycles, boats — with optional auto-loan linkage.
        </p>
        <VehicleForm
          initial={DEFAULT_VEHICLE}
          persons={personOptions}
          autoLoans={autoLoanOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = vehicles.find((v) => v.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit vehicle</h2>
        <VehicleForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            year: target.year,
            make: target.make,
            model: target.model,
            purchaseDate: target.purchaseDate,
            purchasePrice: target.purchasePrice,
            currentEstimatedValue: target.currentEstimatedValue,
            linkedLoanId: target.linkedLoanId,
            excludedFromNetWorth: target.excludedFromNetWorth,
          }}
          persons={personOptions}
          autoLoans={autoLoanOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Vehicles</h2>
        <ImportCsvButton entity="vehicle" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Cars, trucks, motorcycles, and boats — with optional auto-loan linkage.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : vehicles.length === 0 ? (
        error == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            No vehicles added yet.
          </div>
        ) : null
      ) : (
        <div className="space-y-2">
          {vehicles.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'No year/make/model'}
                    {v.currentEstimatedValue != null
                      ? ` · $${v.currentEstimatedValue.toLocaleString()}`
                      : ''}
                    {' · '}
                    {v.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(v.ownerPersonId) ?? 'Unknown owner'}
                    {v.excludedFromNetWorth ? ' · excluded from net worth' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: v.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${v.name}?`,
                        description: 'This permanently removes this vehicle. This can’t be undone.',
                      });
                      if (ok) await remove(v.id!);
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
        <Button onClick={() => setMode('create')}>Add Vehicle</Button>
      </div>
      {dialog}
    </div>
  );
}
