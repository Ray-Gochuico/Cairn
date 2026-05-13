import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { ContributionSchema, type Contribution } from '@/types/schema';
import { ContributionSource } from '@/types/enums';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FormValues = Omit<Contribution, 'id'>;

const SOURCE_LABELS: Record<ContributionSource, string> = {
  [ContributionSource.PAYCHECK]: 'Paycheck',
  [ContributionSource.BONUS]: 'Bonus',
  [ContributionSource.EMPLOYER_MATCH]: 'Employer match',
  [ContributionSource.MANUAL]: 'Manual',
  [ContributionSource.ROLLOVER]: 'Rollover',
};

interface ContributionFormProps {
  initial: FormValues;
  accounts: Array<{ id: number; name: string }>;
  persons: Array<{ id: number; name: string }>;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}

function ContributionForm({ initial, accounts, persons, onSubmit, onCancel }: ContributionFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(ContributionSchema.omit({ id: true })),
    defaultValues: initial,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Contribution details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="accountId">Account</Label>
            <select
              id="accountId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('accountId', { valueAsNumber: true })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="personId">Person</Label>
            <select
              id="personId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('personId', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
            >
              <option value="">None</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="date">Date</Label>
              <DatePicker
                id="date"
                value={form.watch('date')}
                onChange={(v) =>
                  form.setValue('date', v, { shouldDirty: true, shouldTouch: true })
                }
              />
            </div>
            <div>
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                type="number"
                step="any"
                {...form.register('amount', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="source">Source</Label>
            <select
              id="source"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('source')}
            >
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {Object.keys(form.formState.errors).length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="font-medium mb-1">Fix these before saving:</div>
          <ul className="list-disc pl-5">
            {Object.entries(form.formState.errors).map(([field, err]) => (
              <li key={field}>
                <span className="font-mono">{field}</span>:{' '}
                {(err as { message?: string })?.message ?? 'invalid'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={form.formState.isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

export default function ContributionsTab() {
  const { contributions, load, create, update, remove } = useContributionsStore();
  const { accounts, load: loadAccounts } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadAccounts();
    loadPersons();
  }, [load, loadAccounts, loadPersons]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!contributions.some((c) => c.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, contributions]);

  const accountOptions = accounts.map((a) => ({ id: a.id!, name: a.name }));
  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const accountById = new Map(accountOptions.map((a) => [a.id, a.name]));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (accounts.length === 0) {
    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-2xl font-semibold mb-1">Contributions</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Money flowing into your accounts — paychecks, bonuses, manual transfers.
        </p>
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          Add accounts first.
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultContribution: FormValues = {
    accountId: accounts[0].id!,
    personId: persons[0]?.id ?? null,
    date: today,
    amount: 0,
    source: ContributionSource.PAYCHECK,
  };

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add contribution</h2>
        <ContributionForm
          initial={defaultContribution}
          accounts={accountOptions}
          persons={personOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = contributions.find((c) => c.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit contribution</h2>
        <ContributionForm
          initial={{
            accountId: target.accountId,
            personId: target.personId,
            date: target.date,
            amount: target.amount,
            source: target.source,
          }}
          accounts={accountOptions}
          persons={personOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Contributions</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Money flowing into your accounts — paychecks, bonuses, manual transfers.
      </p>

      {contributions.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No contributions added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {contributions.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">
                    ${c.amount.toLocaleString()} · {accountById.get(c.accountId) ?? `Account #${c.accountId}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.date} · {SOURCE_LABELS[c.source]}
                    {c.personId != null && personById.get(c.personId)
                      ? ` · ${personById.get(c.personId)}`
                      : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: c.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(c.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Contribution</Button>
      </div>
    </div>
  );
}
