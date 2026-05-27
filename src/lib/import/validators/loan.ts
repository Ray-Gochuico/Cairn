// src/lib/import/validators/loan.ts
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type LoanResolved = Omit<Loan, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isLoanType(v: string): v is LoanType {
  return (Object.values(LoanType) as string[]).includes(v);
}

/**
 * Validate one loan import row. All numeric fields validated for
 * non-negativity; interest_rate constrained to 0..1 (decimal, not %).
 * obligor_person_name, linked_property_name, linked_vehicle_name are
 * optional FK lookups — case-insensitive against the corresponding pool
 * in ValidationContext.
 */
export function validateLoanRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<LoanResolved> {
  const errors: CellError[] = [];

  // name (required)
  const name = (raw.name ?? '').trim();
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be ≤ 100 chars.' });
  }

  // type (required, enum)
  let parsedType: LoanType = LoanType.PERSONAL;
  const rawType = (raw.type ?? '').trim();
  if (rawType.length === 0) {
    errors.push({ field: 'type', message: 'Type is required.' });
  } else if (!isLoanType(rawType)) {
    errors.push({
      field: 'type',
      message: `Unknown type "${rawType}". Expected one of: ${Object.values(LoanType).join(', ')}`,
    });
  } else {
    parsedType = rawType;
  }

  function num(field: string, key: keyof RawRow, opts: { required: boolean; min?: number; max?: number; integer?: boolean }): number {
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
    if (opts.max != null && n > opts.max) {
      errors.push({ field, message: `Must be ≤ ${opts.max}.` });
      return n;
    }
    if (opts.integer && !Number.isInteger(n)) {
      errors.push({ field, message: 'Must be an integer.' });
      return n;
    }
    return n;
  }

  const originalAmount = num('original_amount', 'original_amount', { required: true, min: 0 });
  const currentBalance = num('current_balance', 'current_balance', { required: true, min: 0 });
  const interestRate = num('interest_rate', 'interest_rate', { required: true, min: 0, max: 1 });
  const termMonths = num('term_months', 'term_months', { required: true, min: 1, integer: true });
  const monthlyPayment = num('monthly_payment', 'monthly_payment', { required: true, min: 0 });

  // first_payment_date (required ISO)
  const fpd = (raw.first_payment_date ?? '').trim();
  let firstPaymentDate = '';
  if (fpd.length === 0) {
    errors.push({ field: 'first_payment_date', message: 'First-payment date is required.' });
  } else if (!ISO_DATE_RE.test(fpd)) {
    errors.push({ field: 'first_payment_date', message: 'Use YYYY-MM-DD format.' });
  } else {
    firstPaymentDate = fpd;
  }

  // extra_payment_default (optional, default 0)
  let extraPaymentDefault = 0;
  const epdRaw = (raw.extra_payment_default ?? '').trim();
  if (epdRaw.length > 0) {
    const n = Number(epdRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'extra_payment_default', message: 'Must be a non-negative number.' });
    } else {
      extraPaymentDefault = n;
    }
  }

  // obligor_person_name (optional FK)
  let obligorPersonId: number | null = null;
  const obligor = (raw.obligor_person_name ?? '').trim();
  if (obligor.length > 0) {
    const m = (ctx.persons ?? []).find(
      (p) => p.name.toLowerCase() === obligor.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'obligor_person_name', message: `No person named "${obligor}".` });
    } else {
      obligorPersonId = m.id;
    }
  }

  // linked_property_name (optional FK)
  let linkedPropertyId: number | null = null;
  const lp = (raw.linked_property_name ?? '').trim();
  if (lp.length > 0) {
    const m = (ctx.properties ?? []).find(
      (p) => p.name.toLowerCase() === lp.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'linked_property_name', message: `No property named "${lp}".` });
    } else {
      linkedPropertyId = m.id;
    }
  }

  // linked_vehicle_name (optional FK)
  let linkedVehicleId: number | null = null;
  const lv = (raw.linked_vehicle_name ?? '').trim();
  if (lv.length > 0) {
    const m = (ctx.vehicles ?? []).find(
      (v) => v.name.toLowerCase() === lv.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'linked_vehicle_name', message: `No vehicle named "${lv}".` });
    } else {
      linkedVehicleId = m.id;
    }
  }

  const resolved: LoanResolved = {
    householdId: 1, // stamped at commit time
    obligorPersonId,
    name,
    type: parsedType,
    originalAmount,
    currentBalance,
    interestRate,
    termMonths,
    firstPaymentDate,
    monthlyPayment,
    extraPaymentDefault,
    linkedPropertyId,
    linkedVehicleId,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingLoanConflicts) {
    const existing = ctx.existingLoanConflicts.get(name.toLowerCase());
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function loanTemplateCsv(): string {
  return [
    'name,type,original_amount,current_balance,interest_rate,term_months,first_payment_date,monthly_payment,obligor_person_name,extra_payment_default,linked_property_name,linked_vehicle_name',
    `Mortgage,${LoanType.MORTGAGE},400000,350000,0.065,360,2024-01-01,2528.27,Alice,0,Main Residence,`,
    `Car Loan,${LoanType.AUTO},25000,18000,0.045,60,2024-06-01,466.08,Alice,0,,My Car`,
  ].join('\n');
}
