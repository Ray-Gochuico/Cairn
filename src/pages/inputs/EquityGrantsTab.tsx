import { useCallback, useEffect, useState } from 'react';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import EquityGrantForm, { DEFAULT_EQUITY_GRANT } from '@/components/forms/EquityGrantForm';
import { formatCurrency } from '@/lib/format';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';

export default function EquityGrantsTab() {
  const { equityGrants, load, create, update, remove, isLoading, error } = useEquityGrantsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
  }, [load, loadPersons]);
  const gate = useLoadGate([isLoading], [error], reload);

  // Defer stale-edit-target reset to a separate effect so we never call
  // setMode during render. If the grant we're editing disappears (e.g. an
  // external delete), drop back to the list before the next paint.
  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!equityGrants.some((g) => g.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, equityGrants]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add equity grant</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Track an equity grant with its vesting schedule. Use a template to fill the schedule
          in one click, or build it row-by-row.
        </p>
        <EquityGrantForm
          initial={DEFAULT_EQUITY_GRANT}
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
    const target = equityGrants.find((g) => g.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit equity grant</h2>
        <EquityGrantForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            companyName: target.companyName,
            grantDate: target.grantDate,
            strikePrice: target.strikePrice,
            totalShares: target.totalShares,
            currentFmv: target.currentFmv,
            grantType: target.grantType,
            vestingSchedule: target.vestingSchedule,
            companyValuation: target.companyValuation,
            companyOutstandingShares: target.companyOutstandingShares,
            companyTotalDebt: target.companyTotalDebt,
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
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Equity grants</h2>
        <ImportCsvButton entity="equity_grant" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        RSUs, options, and other equity awards with their vesting schedules. Drives the Equity
        Grants page and net worth calculations.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : equityGrants.length === 0 ? (
        error == null ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <div className="mb-3">No equity grants added yet.</div>
              <Button onClick={() => setMode('create')}>Add a grant</Button>
            </CardContent>
          </Card>
        ) : null
      ) : (
        <>
          <div className="space-y-2">
            {equityGrants.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.companyName}
                      {' · '}
                      {personById.get(g.ownerPersonId) ?? 'Unknown owner'}
                      {' · '}
                      Granted {g.grantDate}
                      {' · '}
                      {g.totalShares.toLocaleString()} shares @ {formatCurrency(g.currentFmv)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMode({ type: 'edit', id: g.id! })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete ${g.name}?`,
                          description:
                            'This permanently removes this equity grant and its vesting schedule. This can’t be undone.',
                        });
                        if (ok) await remove(g.id!);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4">
            <Button onClick={() => setMode('create')}>Add Grant</Button>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
