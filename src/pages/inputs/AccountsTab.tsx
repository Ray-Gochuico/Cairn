import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { AccountSchema, type Account } from '@/types/schema';
import { AccountType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FormValues = Omit<Account, 'id'>;

const DEFAULT_ACCOUNT: FormValues = {
  householdId: 1,
  ownerPersonId: null,
  beneficiaryDependentId: null,
  name: '',
  institution: null,
  type: AccountType.ACCOUNT_BROKERAGE,
  cryptoWalletAddress: null,
  autoFetchEnabled: false,
  excludedFromNetWorth: false,
  stateOfPlan: null,
};

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.ACCOUNT_401K]: '401(k)',
  [AccountType.ACCOUNT_ROTH_IRA]: 'Roth IRA',
  [AccountType.ACCOUNT_TRAD_IRA]: 'Traditional IRA',
  [AccountType.ACCOUNT_BROKERAGE]: 'Brokerage',
  [AccountType.ACCOUNT_HSA]: 'HSA',
  [AccountType.ACCOUNT_CRYPTO]: 'Crypto',
  [AccountType.ACCOUNT_CASH]: 'Cash',
  [AccountType.ACCOUNT_SAVINGS]: 'Savings',
  [AccountType.ACCOUNT_529]: '529 Plan',
};

interface AccountFormProps {
  initial: FormValues;
  persons: Array<{ id: number; name: string }>;
  dependents: Array<{ id: number; name: string }>;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}

function AccountForm({ initial, persons, dependents, onSubmit, onCancel }: AccountFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(AccountSchema.omit({ id: true })),
    defaultValues: initial,
  });

  const currentType = form.watch('type');
  const is529 = currentType === AccountType.ACCOUNT_529;
  const isCrypto = currentType === AccountType.ACCOUNT_CRYPTO;
  const onlyOnePerson = persons.length === 1;
  const noPersons = persons.length === 0;

  // For single-person households, force ownership to that person so the schema validates.
  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('ownerPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  if (noPersons) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            Add a person first.
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Account details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} />
            </div>
            <div>
              <Label htmlFor="institution">Institution (optional)</Label>
              <Input
                id="institution"
                {...form.register('institution', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('type')}
            >
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {!onlyOnePerson && (
            <fieldset>
              <legend className="text-sm font-medium mb-2">Owner</legend>
              <div className="flex flex-wrap gap-4">
                {persons.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="ownerPersonId"
                      value={String(p.id)}
                      checked={form.watch('ownerPersonId') === p.id}
                      onChange={() =>
                        form.setValue('ownerPersonId', p.id, { shouldDirty: true, shouldTouch: true })
                      }
                    />
                    {p.name}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ownerPersonId"
                    value=""
                    checked={form.watch('ownerPersonId') === null}
                    onChange={() =>
                      form.setValue('ownerPersonId', null, { shouldDirty: true, shouldTouch: true })
                    }
                  />
                  Joint
                </label>
              </div>
            </fieldset>
          )}

          {is529 && (
            <>
              <div>
                <Label htmlFor="beneficiaryDependentId">Beneficiary</Label>
                <select
                  id="beneficiaryDependentId"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  {...form.register('beneficiaryDependentId', {
                    setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
                  })}
                >
                  <option value="">None</option>
                  {dependents.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="stateOfPlan">State of plan (2-letter code)</Label>
                <Input
                  id="stateOfPlan"
                  maxLength={2}
                  placeholder="CA"
                  {...form.register('stateOfPlan', {
                    setValueAs: (v) => {
                      if (v === '' || v === null) return null;
                      return typeof v === 'string' ? v.toUpperCase() : v;
                    },
                  })}
                />
              </div>
            </>
          )}

          {isCrypto && (
            <div>
              <Label htmlFor="cryptoWalletAddress">Crypto wallet address (optional)</Label>
              <Input
                id="cryptoWalletAddress"
                {...form.register('cryptoWalletAddress', { setValueAs: (v) => (v === '' ? null : v) })}
              />
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('autoFetchEnabled')} />
              Auto-fetch balance (Phase 3+)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('excludedFromNetWorth')} />
              Exclude from net worth
            </label>
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

export default function AccountsTab() {
  const { accounts, load, create, update, remove } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
    loadDependents();
  }, [load, loadPersons, loadDependents]);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!accounts.some((a) => a.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, accounts]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add account</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Investment, savings, cash, crypto, and 529 accounts.
        </p>
        <AccountForm
          initial={DEFAULT_ACCOUNT}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = accounts.find((a) => a.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit account</h2>
        <AccountForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            beneficiaryDependentId: target.beneficiaryDependentId,
            name: target.name,
            institution: target.institution,
            type: target.type,
            cryptoWalletAddress: target.cryptoWalletAddress,
            autoFetchEnabled: target.autoFetchEnabled,
            excludedFromNetWorth: target.excludedFromNetWorth,
            stateOfPlan: target.stateOfPlan,
          }}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Accounts</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Every investment, savings, cash, crypto, and 529 account you want to track.
      </p>

      {accounts.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No accounts added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {' · '}
                    {a.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(a.ownerPersonId) ?? 'Unknown owner'}
                    {a.excludedFromNetWorth ? ' · excluded from net worth' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: a.id! })}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(a.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Account</Button>
      </div>
    </div>
  );
}
