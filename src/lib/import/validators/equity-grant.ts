// src/lib/import/validators/equity-grant.ts
import { z } from 'zod';
import type { EquityGrant } from '@/types/schema';
import { GrantType } from '@/types/enums';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type EquityGrantResolved = Omit<EquityGrant, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VestingEntrySchema = z.object({
  date: z.string().regex(ISO_DATE_RE, 'Each row must have date YYYY-MM-DD.'),
  cumulativePct: z.number().min(0).max(1),
});

interface VestingResult {
  rows: Array<{ date: string; cumulativePct: number }>;
}

/**
 * Parse and validate the vesting_schedule_json cell. Returns either a
 * structured row list or a human-readable error message. The validation
 * mirrors EquityGrantSchema's refinements:
 *  - JSON parses as an array of {date, cumulativePct} rows.
 *  - Dates monotonically non-decreasing.
 *  - cumulativePct monotonically non-decreasing.
 *  - Final cumulativePct = 1.0 (within 1e-9 tolerance).
 */
function parseAndValidateVestingJson(raw: string): VestingResult | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'Invalid JSON.';
  }
  if (!Array.isArray(parsed)) return 'Must be a JSON array.';
  const rowResult = z.array(VestingEntrySchema).min(1).safeParse(parsed);
  if (!rowResult.success) {
    return 'Each row must be {date: YYYY-MM-DD, cumulativePct: 0..1}.';
  }
  const rows = rowResult.data;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date < rows[i - 1].date) {
      return 'Dates must be monotonically increasing.';
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cumulativePct < rows[i - 1].cumulativePct) {
      return 'cumulativePct must be monotonically non-decreasing.';
    }
  }
  const last = rows[rows.length - 1].cumulativePct;
  if (Math.abs(last - 1.0) > 1e-9) {
    return `Final cumulativePct must be 1.0 (got ${last}).`;
  }
  return { rows };
}

/**
 * Validate one equity-grant import row. The trickiest field is
 * `vesting_schedule_json` which is parsed + monotonicity-checked +
 * verified to end at cumulativePct = 1.0. owner_person_name is required
 * (grants are individual, not joint).
 */
export function validateEquityGrantRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<EquityGrantResolved> {
  const errors: CellError[] = [];

  const name = (raw.name ?? '').trim();
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be ≤ 100 chars.' });
  }

  const companyName = (raw.company_name ?? '').trim();
  if (companyName.length === 0) {
    errors.push({ field: 'company_name', message: 'Company name is required.' });
  }

  // owner_person_name (required)
  let ownerPersonId = 0;
  const ownerName = (raw.owner_person_name ?? '').trim();
  if (ownerName.length === 0) {
    errors.push({ field: 'owner_person_name', message: 'Owner is required.' });
  } else {
    const m = (ctx.persons ?? []).find(
      (p) => p.name.toLowerCase() === ownerName.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'owner_person_name', message: `No person named "${ownerName}".` });
    } else {
      ownerPersonId = m.id;
    }
  }

  // grant_date (required ISO, ≤ today)
  const gdRaw = (raw.grant_date ?? '').trim();
  let grantDate = '';
  if (gdRaw.length === 0) {
    errors.push({ field: 'grant_date', message: 'Grant date is required.' });
  } else if (!ISO_DATE_RE.test(gdRaw)) {
    errors.push({ field: 'grant_date', message: 'Use YYYY-MM-DD format.' });
  } else {
    grantDate = gdRaw;
  }

  function num(field: string, key: keyof RawRow, opts: { required: boolean; min?: number }): number {
    const v = (raw[key as string] ?? '').trim();
    if (v.length === 0) {
      if (opts.required) errors.push({ field, message: 'Required.' });
      return 0;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors.push({ field, message: 'Must be numeric.' });
      return 0;
    }
    if (opts.min != null && n < opts.min) {
      errors.push({ field, message: `Must be ≥ ${opts.min}.` });
      return n;
    }
    return n;
  }

  const strikePrice = num('strike_price', 'strike_price', { required: true, min: 0 });
  const totalShares = num('total_shares', 'total_shares', { required: true, min: 0 });
  const currentFmv = num('current_fmv', 'current_fmv', { required: true, min: 0 });

  // optional company-valuation calculator inputs
  function optionalNum(field: string, key: keyof RawRow, opts: { min?: number; positive?: boolean }): number | null {
    const v = (raw[key as string] ?? '').trim();
    if (v.length === 0) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors.push({ field, message: 'Must be numeric.' });
      return null;
    }
    if (opts.positive && n <= 0) {
      errors.push({ field, message: 'Must be > 0.' });
      return null;
    }
    if (opts.min != null && n < opts.min) {
      errors.push({ field, message: `Must be ≥ ${opts.min}.` });
      return null;
    }
    return n;
  }
  const companyValuation = optionalNum('company_valuation', 'company_valuation', { min: 0 });
  const companyOutstandingShares = optionalNum('company_outstanding_shares', 'company_outstanding_shares', { positive: true });
  const companyTotalDebt = optionalNum('company_total_debt', 'company_total_debt', { min: 0 });

  // vesting_schedule_json (required)
  let vestingRows: Array<{ date: string; cumulativePct: number }> = [];
  const vesRaw = (raw.vesting_schedule_json ?? '').trim();
  if (vesRaw.length === 0) {
    errors.push({ field: 'vesting_schedule_json', message: 'Vesting schedule is required.' });
  } else {
    const result = parseAndValidateVestingJson(vesRaw);
    if (typeof result === 'string') {
      errors.push({ field: 'vesting_schedule_json', message: result });
    } else {
      vestingRows = result.rows;
    }
  }

  const resolved: EquityGrantResolved = {
    householdId: 1, // stamped at commit time
    ownerPersonId,
    name,
    companyName,
    grantDate,
    strikePrice,
    totalShares,
    vestingSchedule: vestingRows,
    currentFmv,
    // Wave 1 Task 1 (foundation): default to RSU so importer round-trips stay
    // valid. Parsing the grant_type CSV cell (enum validation + invalid-flag) +
    // the CSV header/template are added in Task 2.
    grantType: GrantType.RSU,
    companyValuation,
    companyOutstandingShares,
    companyTotalDebt,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingEquityGrantConflicts) {
    const existing = ctx.existingEquityGrantConflicts.get(name.toLowerCase());
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function equityGrantTemplateCsv(): string {
  const vesting = JSON.stringify([
    { date: '2026-01-01', cumulativePct: 0.25 },
    { date: '2029-01-01', cumulativePct: 1.0 },
  ]);
  return [
    'name,company_name,owner_person_name,grant_date,strike_price,total_shares,current_fmv,vesting_schedule_json,company_valuation,company_outstanding_shares,company_total_debt',
    `Series B RSUs,Startup Inc,Alice,2025-01-01,0,1000,10,"${vesting.replace(/"/g, '""')}",,,`,
  ].join('\n');
}
