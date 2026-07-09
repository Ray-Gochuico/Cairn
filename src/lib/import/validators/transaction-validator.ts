// src/lib/import/validators/transaction-validator.ts
import type { CellError, PreviewRow, RawRow, RowId, ValidationContext } from '@/lib/import/types';
import { resolveAccount, resolvePerson } from '@/lib/import/resolver';
import { parseImportAmount } from '@/lib/import/amount';

export interface TransactionResolved {
  accountId?: number;
  date?: string;
  amount?: number;
  merchant?: string;
  categoryId?: number;
  reimbursable: boolean;
  personId: number | null;
  source: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REIMB_TRUE = new Set(['true', '1', 'yes', 'y']);
const REIMB_FALSE = new Set(['false', '0', 'no', 'n', '']);

export function validateTransactionRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<TransactionResolved> {
  const errors: CellError[] = [];
  const resolved: TransactionResolved = {
    reimbursable: false,
    personId: null,
    source: raw.source?.trim() || 'CSV_IMPORT',
  };

  const dateRaw = (raw.date ?? '').trim();
  if (!dateRaw) {
    errors.push({ field: 'date', message: 'Date is required' });
  } else if (!ISO_DATE_RE.test(dateRaw)) {
    errors.push({ field: 'date', message: 'Use YYYY-MM-DD format' });
  } else if (!isRealCalendarDate(dateRaw)) {
    errors.push({ field: 'date', message: 'Not a valid calendar date' });
  } else {
    resolved.date = dateRaw;
  }

  const explicitId = raw.account_id ? parseExplicitId(raw.account_id) : null;
  const accountRes = resolveAccount(raw.account ?? '', explicitId, ctx.accounts);
  if (accountRes.ok) {
    resolved.accountId = accountRes.accountId;
  } else if (accountRes.reason === 'ambiguous') {
    errors.push({
      field: 'account',
      message: `Account name matches ${accountRes.matches!.length} accounts — add account_id column`,
    });
  } else {
    errors.push({
      field: 'account',
      message: raw.account?.trim() ? `No account named "${raw.account}"` : 'Account is required',
    });
  }

  const amountRaw = (raw.amount ?? '').trim();
  if (!amountRaw) {
    errors.push({ field: 'amount', message: 'Amount is required' });
  } else {
    // Wave-9 S78: locale-aware parsing (EU "1.234,56" / "1 234,56" no longer
    // corrupt silently); null → row error instead of a silently-wrong number.
    const n = parseImportAmount(amountRaw);
    if (n == null) {
      errors.push({ field: 'amount', message: `Unparseable amount "${amountRaw}"` });
    } else {
      // Wave-9 chip b: negative-debit bank CSVs opt into a whole-file sign flip
      // (the preview modal offers it) so their spending isn't ignored by
      // isRealSpending's positive-only convention.
      resolved.amount = ctx.transactionAmountSign === 'FLIP' ? -n : n;
    }
  }

  const merchant = (raw.merchant ?? '').trim();
  if (!merchant) {
    errors.push({ field: 'merchant', message: 'Merchant is required' });
  } else {
    resolved.merchant = merchant;
  }

  const catRaw = (raw.category ?? '').trim();
  if (catRaw && ctx.categories) {
    const cat = ctx.categories.find((c) => c.name.trim().toLowerCase() === catRaw.toLowerCase());
    if (cat) {
      resolved.categoryId = cat.id;
    } else {
      errors.push({ field: 'category', message: `No category named "${catRaw}"` });
    }
  }

  const reimbRaw = (raw.reimbursable ?? '').trim().toLowerCase();
  if (REIMB_TRUE.has(reimbRaw)) {
    resolved.reimbursable = true;
  } else if (!REIMB_FALSE.has(reimbRaw)) {
    errors.push({ field: 'reimbursable', message: 'Must be true / false (or 1/0, yes/no)' });
  }

  if (ctx.persons) {
    const personRaw = (raw.person ?? '').trim();
    const personRes = resolvePerson(personRaw, null, ctx.persons);
    if (personRes.ok) {
      resolved.personId = personRes.personId;
    } else {
      errors.push({
        field: 'person',
        message: personRes.reason === 'ambiguous'
          ? `Person name matches ${personRes.matches!.length} persons`
          : `No person named "${personRaw}"`,
      });
    }
  }

  let status: PreviewRow['status'] = 'new';
  if (errors.length > 0) {
    status = 'error';
  } else if (
    ctx.existingTransactionKeys &&
    resolved.accountId !== undefined &&
    resolved.date !== undefined &&
    resolved.amount !== undefined &&
    resolved.merchant !== undefined
  ) {
    const merchantKey = resolved.merchant.trim().toLowerCase();
    const key = `${resolved.accountId}|${resolved.date}|${resolved.amount}|${merchantKey}`;
    if (ctx.existingTransactionKeys.has(key)) {
      status = 'duplicate';
    }
  }

  return { rowId, raw, resolved, status, errors };
}

function parseExplicitId(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

function isRealCalendarDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === iso;
}
