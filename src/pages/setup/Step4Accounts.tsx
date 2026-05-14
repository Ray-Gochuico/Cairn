import { useEffect, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import AccountForm, {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT,
} from '@/components/forms/AccountForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 5 — Accounts. Multi-instance, optional (Continue is
 * always enabled — a user can complete onboarding with zero accounts).
 */
export default function Step4Accounts({ onComplete }: Props) {
  const { accounts, load, create, remove } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
    loadPersons();
    loadDependents();
  }, [load, loadPersons, loadDependents]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Accounts</h2>
        <p className="text-sm text-muted-foreground">
          Add your retirement accounts, brokerage, cash, savings, HSA, crypto, and 529 plans. You can always add more later.
        </p>
      </div>

      {accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.institution ? ` · ${a.institution}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => remove(a.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <AccountForm
          initial={DEFAULT_ACCOUNT}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => {
            await create(v);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
          submitLabel="Add Account"
        />
      )}

      {!showForm && (
        <div>
          <Button variant="outline" onClick={() => setShowForm(true)}>
            {accounts.length === 0 ? 'Add an account' : 'Add another account'}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onComplete}>Continue</Button>
        {accounts.length === 0 && (
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip — no accounts yet
          </Button>
        )}
      </div>
    </div>
  );
}
