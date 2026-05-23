import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AccountSchema, type Account } from '@/types/schema';
import { AccountType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// AccountSchema has allowMargin: z.boolean().default(false), which makes Zod's
// *input* type treat that key as optional. RHF derives its resolver type from
// the schema input type, so the resolver becomes Resolver<Partial<...>> and
// doesn't unify with strict AccountFormValues. Strip the .default() so input
// and output types coincide — DEFAULT_ACCOUNT provides the runtime default.
const AccountFormSchema = AccountSchema.omit({ id: true }).extend({
  allowMargin: z.boolean(),
});

export type AccountFormValues = Omit<Account, 'id'>;

export const DEFAULT_ACCOUNT: AccountFormValues = {
  householdId: 1,
  ownerPersonId: null,
  beneficiaryDependentId: null,
  name: '',
  institution: null,
  type: AccountType.ACCOUNT_BROKERAGE,
  cryptoWalletAddress: null,
  autoFetchEnabled: false,
  excludedFromNetWorth: false,
  allowMargin: false,
  stateOfPlan: null,
  accentColor: null,
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
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

export interface AccountFormProps {
  initial: AccountFormValues;
  persons: Array<{ id: number; name: string }>;
  dependents: Array<{ id: number; name: string }>;
  onSubmit: (values: AccountFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Standalone account form. Used by both AccountsTab and the SetupWizard
 * Step 4 onboarding flow. The caller owns persons / dependents loading
 * and the submit handler; this component owns RHF state, validation,
 * type-dependent fields (529 beneficiary, crypto wallet), and the
 * single-person ownership defaulting.
 */
export default function AccountForm({
  initial,
  persons,
  dependents,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: AccountFormProps) {
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(AccountFormSchema),
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.watch('allowMargin')}
                onChange={(e) =>
                  form.setValue('allowMargin', e.target.checked, { shouldDirty: true, shouldTouch: true })
                }
              />
              Allow target allocations &gt;100% (margin account)
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
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
