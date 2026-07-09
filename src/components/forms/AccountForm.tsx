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
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

// Wave-9 M41 (mirrors PersonForm's pretax401kPctPercent pattern): the APY
// input is a FORM-ONLY percent field (0..15); the storage fraction (0..0.15)
// never touches the %-labeled input, so a re-init can't show a raw fraction
// and a re-save can't divide twice (4% → 0.04% corruption).
const fractionToPercent = (fraction: number): number => parseFloat((fraction * 100).toFixed(10));
const percentToFraction = (percent: number): number => parseFloat((percent / 100).toFixed(10));

// AccountSchema has allowMargin: z.boolean().default(false), which makes Zod's
// *input* type treat that key as optional. RHF derives its resolver type from
// the schema input type, so the resolver becomes Resolver<Partial<...>> and
// doesn't unify with strict AccountFormValues. Strip the .default() so input
// and output types coincide — DEFAULT_ACCOUNT provides the runtime default.
// W10 M24: the 401(k) plan-benefit flags used to have NO writer anywhere, so
// the roadmap's employer-match / mega-backdoor CTAs dead-ended. They are now
// editable on this form. employerMatchPct/employerMatchLimitPct are STORED as
// FRACTIONS (section1.ts computes `salary * employerMatchLimitPct`), so like
// apyRate they get form-only whole-percent twins that never touch storage.
const AccountFormSchema = AccountSchema.omit({
  id: true,
  employerMatchPct: true,
  employerMatchLimitPct: true,
  hasHighFees: true,
  apyRate: true,
}).extend({
  allowMargin: z.boolean(),
  // Strip the schema's .default(null) (which makes these optional in the input
  // type and breaks resolver unification, same as allowMargin above).
  hasEmployerMatch: z.boolean().nullable(),
  allowsMegaBackdoorRollover: z.boolean().nullable(),
  apyRatePercent: z.number().min(0).max(15).nullable(),
  employerMatchPctPercent: z.number().min(0).max(100).nullable(),
  employerMatchLimitPctPercent: z.number().min(0).max(100).nullable(),
});

type InternalFormValues = z.infer<typeof AccountFormSchema>;

// Strip only the roadmap chart-answer column written by other surfaces
// (hasHighFees) and id. The 401(k) plan-benefit flags ARE written here now.
export type AccountFormValues = Omit<Account, 'id' | 'hasHighFees'>;

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
  apyRate: null,
  hasEmployerMatch: null,
  employerMatchPct: null,
  employerMatchLimitPct: null,
  allowsMegaBackdoorRollover: null,
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.ACCOUNT_ROTH_401K]: 'Roth 401(k)',
  [AccountType.ACCOUNT_401K]: 'Traditional 401(k)',
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
  // Translate storage shape → internal form shape: drop the fraction-stored
  // rate fields, synthesize their whole-percent twins. Reverse on submit.
  const {
    apyRate: _initialApyFraction,
    employerMatchPct: _initialMatchFraction,
    employerMatchLimitPct: _initialLimitFraction,
    ...initialRest
  } = initial;
  const internalInitial: InternalFormValues = {
    ...initialRest,
    apyRatePercent: _initialApyFraction != null ? fractionToPercent(_initialApyFraction) : null,
    employerMatchPctPercent: _initialMatchFraction != null ? fractionToPercent(_initialMatchFraction) : null,
    employerMatchLimitPctPercent: _initialLimitFraction != null ? fractionToPercent(_initialLimitFraction) : null,
  };

  const form = useForm<InternalFormValues>({
    resolver: zodResolver(AccountFormSchema),
    defaultValues: internalInitial,
  });

  // Callers still receive storage-shaped AccountFormValues (fraction rates).
  const wrappedSubmit = (values: InternalFormValues): Promise<void> => {
    const { apyRatePercent, employerMatchPctPercent, employerMatchLimitPctPercent, ...rest } = values;
    return onSubmit({
      ...rest,
      apyRate: apyRatePercent != null ? percentToFraction(apyRatePercent) : null,
      employerMatchPct: employerMatchPctPercent != null ? percentToFraction(employerMatchPctPercent) : null,
      employerMatchLimitPct: employerMatchLimitPctPercent != null ? percentToFraction(employerMatchLimitPctPercent) : null,
    });
  };

  // W10 M44: a rejected save used to escape as an unhandled rejection.
  const { onValid, submitting, submitError } = useFormSubmit(wrappedSubmit);

  const currentType = form.watch('type');
  const is529 = currentType === AccountType.ACCOUNT_529;
  const isCrypto = currentType === AccountType.ACCOUNT_CRYPTO;
  const is401kFamily =
    currentType === AccountType.ACCOUNT_401K || currentType === AccountType.ACCOUNT_ROTH_401K;
  const isCashOrSavings =
    currentType === AccountType.ACCOUNT_CASH || currentType === AccountType.ACCOUNT_SAVINGS;
  const onlyOnePerson = persons.length === 1;
  const noPersons = persons.length === 0;

  // For single-person households, force ownership to that person so the schema validates.
  useEffect(() => {
    if (onlyOnePerson) {
      form.setValue('ownerPersonId', persons[0].id, { shouldDirty: false });
    }
  }, [onlyOnePerson, persons, form]);

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Account details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...form.register('name')}
                aria-invalid={form.formState.errors.name ? true : undefined}
                aria-describedby={form.formState.errors.name ? 'account-name-error' : undefined}
              />
              <FieldError id="account-name-error" message={form.formState.errors.name?.message} />
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

          {noPersons && (
            <p className="text-sm text-muted-foreground">
              No owner set — you can assign one later in Section 1.
            </p>
          )}

          {!onlyOnePerson && persons.length > 0 && (
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

          {isCashOrSavings && (
            <div>
              <Label htmlFor="apyRatePercent">Annual percent yield (APY %)</Label>
              <Input
                id="apyRatePercent"
                type="number"
                step="0.01"
                min="0"
                max="15"
                placeholder="0.0"
                {...form.register('apyRatePercent', {
                  setValueAs: (v) => {
                    if (v === '' || v === null || v === undefined) return null;
                    const n = Number(v);
                    return Number.isFinite(n) ? n : null;
                  },
                })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank to use the household default.
              </p>
            </div>
          )}

          {is401kFamily && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">401(k) plan details</legend>
              <p className="text-xs text-muted-foreground">
                Powers the Roadmap's employer-match and mega-backdoor steps.
              </p>
              <div>
                <Label htmlFor="hasEmployerMatch">Employer match?</Label>
                <select
                  id="hasEmployerMatch"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.watch('hasEmployerMatch') === true ? 'yes' : form.watch('hasEmployerMatch') === false ? 'no' : 'unknown'}
                  onChange={(e) =>
                    form.setValue(
                      'hasEmployerMatch',
                      e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null,
                      { shouldDirty: true, shouldTouch: true },
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              {form.watch('hasEmployerMatch') === true && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="employerMatchPctPercent">Match rate (%)</Label>
                    <Input
                      id="employerMatchPctPercent"
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      placeholder="50"
                      {...form.register('employerMatchPctPercent', {
                        setValueAs: (v) => {
                          if (v === '' || v === null || v === undefined) return null;
                          const n = Number(v);
                          return Number.isFinite(n) ? n : null;
                        },
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="employerMatchLimitPctPercent">Match limit (% of salary)</Label>
                    <Input
                      id="employerMatchLimitPctPercent"
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      placeholder="6"
                      {...form.register('employerMatchLimitPctPercent', {
                        setValueAs: (v) => {
                          if (v === '' || v === null || v === undefined) return null;
                          const n = Number(v);
                          return Number.isFinite(n) ? n : null;
                        },
                      })}
                    />
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="allowsMegaBackdoorRollover">Allows mega-backdoor Roth?</Label>
                <select
                  id="allowsMegaBackdoorRollover"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.watch('allowsMegaBackdoorRollover') === true ? 'yes' : form.watch('allowsMegaBackdoorRollover') === false ? 'no' : 'unknown'}
                  onChange={(e) =>
                    form.setValue(
                      'allowsMegaBackdoorRollover',
                      e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null,
                      { shouldDirty: true, shouldTouch: true },
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </fieldset>
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

      <FormErrorSummary fieldErrors={form.formState.errors} submitError={submitError} />

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: submitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
