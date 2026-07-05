import { useEffect, useState } from 'react';
import { usePropertiesStore } from '@/stores/properties-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import PropertyForm, {
  DEFAULT_PROPERTY,
  PROPERTY_TYPE_LABELS,
} from '@/components/forms/PropertyForm';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';

export default function PropertiesTab() {
  const { properties, load, create, update, remove } = usePropertiesStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
    loadLoans();
  }, [load, loadPersons, loadLoans]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!properties.some((p) => p.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, properties]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const mortgageLoanOptions = loans
    .filter((l) => l.type === LoanType.MORTGAGE)
    .map((l) => ({ id: l.id!, name: l.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add property</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Primary residence, rental, vacation home, or land.
        </p>
        <PropertyForm
          initial={DEFAULT_PROPERTY}
          persons={personOptions}
          mortgageLoans={mortgageLoanOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = properties.find((p) => p.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit property</h2>
        <PropertyForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            name: target.name,
            type: target.type,
            address: target.address,
            purchaseDate: target.purchaseDate,
            purchasePrice: target.purchasePrice,
            currentEstimatedValue: target.currentEstimatedValue,
            linkedLoanId: target.linkedLoanId,
            excludedFromNetWorth: target.excludedFromNetWorth,
          }}
          persons={personOptions}
          mortgageLoans={mortgageLoanOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Properties</h2>
        <ImportCsvButton entity="property" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Homes, rentals, vacation properties, and land — with optional mortgage linkage.
      </p>

      {properties.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No properties added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {properties.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {PROPERTY_TYPE_LABELS[p.type]}
                    {p.currentEstimatedValue != null
                      ? ` · $${p.currentEstimatedValue.toLocaleString()}`
                      : ''}
                    {' · '}
                    {p.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(p.ownerPersonId) ?? 'Unknown owner'}
                    {p.excludedFromNetWorth
                      ? p.linkedLoanId != null
                        ? ' · excluded from net worth (linked mortgage still counts)'
                        : ' · excluded from net worth'
                      : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: p.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${p.name}?`,
                        description: 'This permanently removes this property. This can’t be undone.',
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
        <Button onClick={() => setMode('create')}>Add Property</Button>
      </div>
      {dialog}
    </div>
  );
}
