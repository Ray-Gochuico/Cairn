import { describe, it, expect } from 'vitest';
import { validateLoanRow, loanTemplateCsv } from '@/lib/import/validators/loan';
import type { ValidationContext } from '@/lib/import/types';
import type { Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [],
    persons: [{ id: 1, name: 'Alice' }],
    categories: [],
    properties: [{ id: 7, name: 'Main Residence' }],
    vehicles: [{ id: 9, name: 'My Car' }],
    ...overrides,
  };
}

function validLoanRaw(): Record<string, string> {
  return {
    name: 'Mortgage',
    type: LoanType.MORTGAGE,
    original_amount: '400000',
    current_balance: '350000',
    interest_rate: '0.065',
    term_months: '360',
    first_payment_date: '2024-01-01',
    monthly_payment: '2528.27',
  };
}

describe('validateLoanRow', () => {
  it('parses a minimal valid row as status=new', () => {
    const row = validateLoanRow(validLoanRaw(), 0, ctx());
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.type).toBe(LoanType.MORTGAGE);
  });

  it('errors on unknown loan type', () => {
    const row = validateLoanRow({ ...validLoanRaw(), type: 'BAD' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('errors on interest_rate > 1', () => {
    const row = validateLoanRow({ ...validLoanRaw(), interest_rate: '6.5' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'interest_rate')).toBe(true);
  });

  it('errors on negative original_amount', () => {
    const row = validateLoanRow({ ...validLoanRaw(), original_amount: '-1' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'original_amount')).toBe(true);
  });

  it('errors on non-integer term_months', () => {
    const row = validateLoanRow({ ...validLoanRaw(), term_months: '12.5' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'term_months')).toBe(true);
  });

  it('errors on bad first_payment_date', () => {
    const row = validateLoanRow({ ...validLoanRaw(), first_payment_date: '12/1/2024' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'first_payment_date')).toBe(true);
  });

  it('resolves obligor_person_name', () => {
    const row = validateLoanRow(
      { ...validLoanRaw(), obligor_person_name: 'alice' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.obligorPersonId).toBe(1);
  });

  it('resolves linked_property_name', () => {
    const row = validateLoanRow(
      { ...validLoanRaw(), linked_property_name: 'Main Residence' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.linkedPropertyId).toBe(7);
  });

  it('errors on unknown linked_vehicle_name', () => {
    const row = validateLoanRow(
      { ...validLoanRaw(), linked_vehicle_name: 'Unknown' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'linked_vehicle_name')).toBe(true);
  });

  it('detects conflicts by lowercased name', () => {
    const existing = new Map<string, Loan>();
    existing.set('mortgage', { id: 5, name: 'Mortgage' } as Loan);
    const row = validateLoanRow(validLoanRaw(), 0, ctx({ existingLoanConflicts: existing }));
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(5);
  });
});

describe('loanTemplateCsv', () => {
  it('emits a header with type, term_months, first_payment_date', () => {
    const csv = loanTemplateCsv();
    expect(csv).toContain('name');
    expect(csv).toContain('term_months');
    expect(csv).toContain('first_payment_date');
  });
});
