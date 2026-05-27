// src/lib/import/validators/contribution.ts
import { ContributionSource } from '@/types/enums';
import type { Contribution } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type ContributionResolved = Omit<Contribution, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isContributionSource(v: string): v is ContributionSource {
  return (Object.values(ContributionSource) as string[]).includes(v);
}

/**
 * Validate one contribution import row. account_name is required (FK
 * lookup against ctx.accounts), date is ISO YYYY-MM-DD, amount must be
 * non-negative, and source defaults to MANUAL when omitted. Conflict
 * detection uses the duplicate set (status='duplicate') rather than
 * an update map — contributions are append-only and the user resolves
 * them via the duplicate-mode selector in the preview modal.
 */
export function validateContributionRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<ContributionResolved> {
  const errors: CellError[] = [];

  // account_name (required FK)
  let accountId = 0;
  const acctName = (raw.account_name ?? '').trim();
  if (acctName.length === 0) {
    errors.push({ field: 'account_name', message: 'Account is required.' });
  } else {
    const m = ctx.accounts.find(
      (a) => a.name.toLowerCase() === acctName.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'account_name', message: `No account named "${acctName}".` });
    } else {
      accountId = m.id;
    }
  }

  // contribution_date (required ISO)
  const dRaw = (raw.contribution_date ?? '').trim();
  let date = '';
  if (dRaw.length === 0) {
    errors.push({ field: 'contribution_date', message: 'Date is required.' });
  } else if (!ISO_DATE_RE.test(dRaw)) {
    errors.push({ field: 'contribution_date', message: 'Use YYYY-MM-DD format.' });
  } else {
    date = dRaw;
  }

  // amount (required ≥ 0)
  const aRaw = (raw.amount ?? '').trim();
  let amount = 0;
  if (aRaw.length === 0) {
    errors.push({ field: 'amount', message: 'Amount is required.' });
  } else {
    const n = Number(aRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'amount', message: 'Must be a non-negative number.' });
    } else {
      amount = n;
    }
  }

  // source (optional, default MANUAL)
  let source: ContributionSource = ContributionSource.MANUAL;
  const srcRaw = (raw.source ?? '').trim();
  if (srcRaw.length > 0) {
    if (!isContributionSource(srcRaw)) {
      errors.push({
        field: 'source',
        message: `Unknown source "${srcRaw}". Expected one of: ${Object.values(ContributionSource).join(', ')}`,
      });
    } else {
      source = srcRaw;
    }
  }

  // person_name (optional FK)
  let personId: number | null = null;
  const personName = (raw.person_name ?? '').trim();
  if (personName.length > 0) {
    const m = (ctx.persons ?? []).find(
      (p) => p.name.toLowerCase() === personName.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'person_name', message: `No person named "${personName}".` });
    } else {
      personId = m.id;
    }
  }

  const resolved: ContributionResolved = {
    accountId,
    personId,
    date,
    amount,
    source,
  };

  let status: PreviewRow['status'] = 'new';
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingContributionDupKeys) {
    const key = `${accountId}::${date}::${amount}`;
    if (ctx.existingContributionDupKeys.has(key)) {
      status = 'duplicate';
    }
  }

  return { rowId, raw, resolved, status, errors };
}

export function contributionTemplateCsv(): string {
  return [
    'account_name,contribution_date,amount,source,person_name',
    `Brokerage,2026-01-15,500,${ContributionSource.MANUAL},Alice`,
    `401k,2026-01-15,1500,${ContributionSource.PAYCHECK},Alice`,
  ].join('\n');
}
