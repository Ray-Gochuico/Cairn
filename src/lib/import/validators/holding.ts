// src/lib/import/validators/holding.ts
import type { Holding } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type HoldingResolved = Omit<Holding, 'id'>;

/**
 * Validate one holding import row. The CSV references its parent account
 * by name (case-insensitive lookup against ctx.accounts); the resolved
 * payload contains the resolved accountId ready for HoldingsRepo.create.
 *
 * `cost_basis_per_share` maps to schema.costBasis (which is per-share —
 * see src/lib/scenarios/state-snapshot.ts uses shareCount * costBasis).
 */
export function validateHoldingRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<HoldingResolved> {
  const errors: CellError[] = [];

  // account_name → accountId (required)
  let accountId = 0;
  const acctName = (raw.account_name ?? '').trim();
  if (acctName.length === 0) {
    errors.push({ field: 'account_name', message: 'Account is required.' });
  } else {
    const match = ctx.accounts.find(
      (a) => a.name.toLowerCase() === acctName.toLowerCase(),
    );
    if (!match) {
      errors.push({
        field: 'account_name',
        message: `No account named "${acctName}".`,
      });
    } else {
      accountId = match.id;
    }
  }

  // ticker (required, uppercased)
  const tickerRaw = (raw.ticker ?? '').trim();
  let ticker = '';
  if (tickerRaw.length === 0) {
    errors.push({ field: 'ticker', message: 'Ticker is required.' });
  } else if (tickerRaw.length > 20) {
    errors.push({ field: 'ticker', message: 'Ticker must be ≤ 20 chars.' });
  } else {
    ticker = tickerRaw.toUpperCase();
  }

  // share_count (required, ≥ 0)
  const scRaw = (raw.share_count ?? '').trim();
  let shareCount = 0;
  if (scRaw.length === 0) {
    errors.push({ field: 'share_count', message: 'Share count is required.' });
  } else {
    const n = Number(scRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'share_count', message: 'Must be a non-negative number.' });
    } else {
      shareCount = n;
    }
  }

  // cost_basis_per_share (optional, ≥ 0)
  let costBasis: number | null = null;
  const cbRaw = (raw.cost_basis_per_share ?? '').trim();
  if (cbRaw.length > 0) {
    const n = Number(cbRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({
        field: 'cost_basis_per_share',
        message: 'Must be a non-negative number (per-share basis).',
      });
    } else {
      costBasis = n;
    }
  }

  // target_allocation_pct (optional, 0..1)
  let targetAllocationPct: number | null = null;
  const taRaw = (raw.target_allocation_pct ?? '').trim();
  if (taRaw.length > 0) {
    const n = Number(taRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      errors.push({
        field: 'target_allocation_pct',
        message: 'Must be a decimal between 0 and 1.',
      });
    } else {
      targetAllocationPct = n;
    }
  }

  const resolved: HoldingResolved = {
    accountId,
    ticker,
    shareCount,
    targetAllocationPct,
    costBasis,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingHoldingConflicts) {
    const existing = ctx.existingHoldingConflicts.get(`${accountId}::${ticker}`);
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function holdingTemplateCsv(): string {
  return [
    'account_name,ticker,share_count,cost_basis_per_share,target_allocation_pct',
    'Brokerage,AAPL,10,150.00,0.05',
    'Brokerage,VTI,250,200.00,0.40',
  ].join('\n');
}
