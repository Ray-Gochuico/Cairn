// src/lib/import/validators/snapshot-validator.ts
import type { CellError, PreviewRow, RawRow, RowId, ValidationContext } from '@/lib/import/types';
import { resolveAccount } from '@/lib/import/resolver';
import { parseImportAmount } from '@/lib/import/amount';

export interface SnapshotResolved {
  accountId?: number;
  snapshotDate?: string;
  totalValue?: number;
  source: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a raw CSV row for snapshot import. Pure function — never
 * touches I/O or stores. Returns the typed PreviewRow with status,
 * errors, and the resolved values that the commit step will write.
 */
export function validateSnapshotRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<SnapshotResolved> {
  const errors: CellError[] = [];
  const resolved: SnapshotResolved = {
    source: raw.source?.trim() || 'CSV_IMPORT',
  };

  const explicitId = raw.account_id ? parseExplicitId(raw.account_id) : null;
  const accountRes = resolveAccount(raw.account ?? '', explicitId, ctx.accounts);
  if (accountRes.ok) {
    resolved.accountId = accountRes.accountId;
  } else if (accountRes.reason === 'ambiguous') {
    errors.push({
      field: 'account',
      message: `Account name matches ${accountRes.matches!.length} accounts — add account_id column to disambiguate`,
    });
  } else {
    errors.push({
      field: 'account',
      message: raw.account?.trim()
        ? `No account named "${raw.account}" — add it in Section 2 → Accounts first, then re-import.`
        : 'Account is required',
    });
  }

  const dateRaw = (raw.snapshot_date ?? '').trim();
  if (!dateRaw) {
    errors.push({ field: 'snapshot_date', message: 'Date is required' });
  } else if (!ISO_DATE_RE.test(dateRaw)) {
    errors.push({ field: 'snapshot_date', message: 'Use YYYY-MM-DD format' });
  } else if (!isRealCalendarDate(dateRaw)) {
    errors.push({ field: 'snapshot_date', message: 'Not a valid calendar date' });
  } else {
    resolved.snapshotDate = dateRaw;
  }

  const valueRaw = (raw.total_value ?? '').trim();
  if (!valueRaw) {
    errors.push({ field: 'total_value', message: 'Value is required' });
  } else {
    // Wave-9 S78: shared locale-aware parsing (same semantics as transactions).
    const numeric = parseImportAmount(valueRaw);
    if (numeric == null) {
      errors.push({ field: 'total_value', message: `Unparseable value "${valueRaw}"` });
    } else {
      resolved.totalValue = numeric;
    }
  }

  let status: PreviewRow['status'] = 'new';
  let existing: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (
    resolved.accountId !== undefined &&
    resolved.snapshotDate !== undefined &&
    ctx.existingSnapshots
  ) {
    const key = `${resolved.accountId}|${resolved.snapshotDate}`;
    const found = ctx.existingSnapshots.get(key);
    if (found !== undefined) {
      status = 'update';
      existing = found;
    }
  }

  return { rowId, raw, resolved, status, errors, existing };
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
