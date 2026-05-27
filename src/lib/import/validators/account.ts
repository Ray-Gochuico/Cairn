// src/lib/import/validators/account.ts
import { AccountType } from '@/types/enums';
import type { Account } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

/**
 * Resolved shape for an account row mid-import — matches `Omit<Account, 'id'>`
 * so the commit step can hand it straight to `AccountsRepo.create / update`.
 * The schema's calculator + rule-engine fields default to safe nulls — the
 * CSV importer only exposes the user-facing primary fields.
 */
export type AccountResolved = Omit<Account, 'id'>;

function isAccountType(v: string): v is AccountType {
  return (Object.values(AccountType) as string[]).includes(v);
}

/**
 * Validate one account import row. The resolved payload is ready to commit
 * via `AccountsRepo.create` (with householdId stamped at commit-time).
 *
 * The CSV's `current_balance` column is validated for sanity (non-negative,
 * numeric) but NOT persisted — accounts don't store a balance; users should
 * use the snapshot importer for that. We keep the validator strict so the
 * preview surface flags negative balances early.
 */
export function validateAccountRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<AccountResolved> {
  const errors: CellError[] = [];

  const name = (raw.name ?? '').trim();
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be ≤ 100 chars.' });
  }

  const rawType = (raw.type ?? '').trim();
  let parsedType: AccountType = AccountType.ACCOUNT_CASH;
  if (rawType.length === 0) {
    errors.push({ field: 'type', message: 'Type is required.' });
  } else if (!isAccountType(rawType)) {
    errors.push({
      field: 'type',
      message: `Unknown type "${rawType}". Expected one of: ${Object.values(AccountType).join(', ')}`,
    });
  } else {
    parsedType = rawType;
  }

  const balanceRaw = (raw.current_balance ?? '').trim();
  if (balanceRaw.length > 0) {
    const balanceNum = Number(balanceRaw);
    if (!Number.isFinite(balanceNum) || balanceNum < 0) {
      errors.push({ field: 'current_balance', message: 'Must be a non-negative number.' });
    }
  }

  // owner_person_name (optional)
  let ownerPersonId: number | null = null;
  const ownerName = (raw.owner_person_name ?? '').trim();
  if (ownerName.length > 0) {
    const match = (ctx.persons ?? []).find(
      (p) => p.name.toLowerCase() === ownerName.toLowerCase(),
    );
    if (!match) {
      errors.push({
        field: 'owner_person_name',
        message: `No person named "${ownerName}".`,
      });
    } else {
      ownerPersonId = match.id;
    }
  }

  // accent_color (optional hex)
  let accentColor: string | null = null;
  const accentRaw = (raw.accent_color ?? '').trim();
  if (accentRaw.length > 0) {
    if (!/^#[0-9a-fA-F]{6}$/.test(accentRaw)) {
      errors.push({ field: 'accent_color', message: 'Must be a hex color like #2563eb.' });
    } else {
      accentColor = accentRaw;
    }
  }

  // apy_rate (optional 0..1)
  let apyRate: number | null = null;
  const apyRaw = (raw.apy_rate ?? '').trim();
  if (apyRaw.length > 0) {
    const n = Number(apyRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      errors.push({ field: 'apy_rate', message: 'Must be a decimal between 0 and 1.' });
    } else {
      apyRate = n;
    }
  }

  // institution (optional)
  const institution = (raw.institution ?? '').trim() || null;

  const resolved: AccountResolved = {
    householdId: 1, // stamped at commit time by Deps.householdId
    ownerPersonId,
    beneficiaryDependentId: null,
    name,
    institution,
    type: parsedType,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    apyRate,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingAccountConflicts) {
    const existing = ctx.existingAccountConflicts.get(name.toLowerCase());
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function accountTemplateCsv(): string {
  return [
    'name,type,current_balance,owner_person_name,institution,accent_color,apy_rate',
    `Chase Checking,${AccountType.ACCOUNT_CASH},2500,Alice,Chase,#2563eb,0.005`,
    `Vanguard Brokerage,${AccountType.ACCOUNT_BROKERAGE},150000,Alice,Vanguard,,`,
  ].join('\n');
}
