import { describe, it, expect } from 'vitest';
import { validateEquityGrantRow, equityGrantTemplateCsv } from '@/lib/import/validators/equity-grant';
import type { ValidationContext } from '@/lib/import/types';
import type { EquityGrant } from '@/types/schema';

const VALID_VESTING = JSON.stringify([
  { date: '2026-01-01', cumulativePct: 0.25 },
  { date: '2029-01-01', cumulativePct: 1.0 },
]);

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [],
    persons: [{ id: 1, name: 'Alice' }],
    categories: [],
    properties: [],
    vehicles: [],
    ...overrides,
  };
}

function validRaw(): Record<string, string> {
  return {
    name: 'Series B RSUs',
    company_name: 'Startup Inc',
    owner_person_name: 'Alice',
    grant_date: '2025-01-01',
    strike_price: '0',
    total_shares: '1000',
    current_fmv: '10',
    vesting_schedule_json: VALID_VESTING,
  };
}

describe('validateEquityGrantRow', () => {
  it('parses a minimal valid row as status=new', () => {
    const row = validateEquityGrantRow(validRaw(), 0, ctx());
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.ownerPersonId).toBe(1);
    expect(row.resolved.vestingSchedule).toHaveLength(2);
  });

  it('errors on missing required fields', () => {
    const row = validateEquityGrantRow({}, 0, ctx());
    expect(row.errors.some((e) => e.field === 'name')).toBe(true);
    expect(row.errors.some((e) => e.field === 'company_name')).toBe(true);
    expect(row.errors.some((e) => e.field === 'owner_person_name')).toBe(true);
    expect(row.errors.some((e) => e.field === 'grant_date')).toBe(true);
    expect(row.errors.some((e) => e.field === 'strike_price')).toBe(true);
    expect(row.errors.some((e) => e.field === 'total_shares')).toBe(true);
    expect(row.errors.some((e) => e.field === 'current_fmv')).toBe(true);
    expect(row.errors.some((e) => e.field === 'vesting_schedule_json')).toBe(true);
  });

  it('errors on negative strike_price', () => {
    const row = validateEquityGrantRow({ ...validRaw(), strike_price: '-1' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'strike_price')).toBe(true);
  });

  it('errors on owner_person_name miss', () => {
    const row = validateEquityGrantRow(
      { ...validRaw(), owner_person_name: 'Carol' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'owner_person_name')).toBe(true);
  });

  it('errors on malformed JSON', () => {
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: 'garbage' },
      0,
      ctx(),
    );
    expect(row.errors.find((e) => e.field === 'vesting_schedule_json')?.message).toMatch(/Invalid JSON/);
  });

  it('errors when JSON is not an array', () => {
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: '{}' },
      0,
      ctx(),
    );
    expect(row.errors.find((e) => e.field === 'vesting_schedule_json')?.message).toMatch(/array/);
  });

  it('errors when an array element is shape-wrong', () => {
    const bad = JSON.stringify([{ wrong: 'field' }]);
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: bad },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'vesting_schedule_json')).toBe(true);
  });

  it('errors when dates are non-monotonic', () => {
    const bad = JSON.stringify([
      { date: '2029-01-01', cumulativePct: 0.25 },
      { date: '2026-01-01', cumulativePct: 1.0 },
    ]);
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: bad },
      0,
      ctx(),
    );
    expect(row.errors.find((e) => e.field === 'vesting_schedule_json')?.message).toMatch(/monotonic/i);
  });

  it('errors when cumulativePct is non-monotonic', () => {
    const bad = JSON.stringify([
      { date: '2026-01-01', cumulativePct: 0.5 },
      { date: '2029-01-01', cumulativePct: 0.25 },
    ]);
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: bad },
      0,
      ctx(),
    );
    expect(row.errors.find((e) => e.field === 'vesting_schedule_json')?.message).toMatch(/monotonic/i);
  });

  it('errors when the final cumulativePct is not 1.0', () => {
    const bad = JSON.stringify([
      { date: '2026-01-01', cumulativePct: 0.25 },
      { date: '2029-01-01', cumulativePct: 0.9 },
    ]);
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: bad },
      0,
      ctx(),
    );
    expect(row.errors.find((e) => e.field === 'vesting_schedule_json')?.message).toMatch(/1\.0/);
  });

  it('accepts final cumulativePct = 0.99999 within tolerance', () => {
    const ok = JSON.stringify([
      { date: '2026-01-01', cumulativePct: 0.5 },
      { date: '2029-01-01', cumulativePct: 1.0 - 1e-10 },
    ]);
    const row = validateEquityGrantRow(
      { ...validRaw(), vesting_schedule_json: ok },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
  });

  it('detects conflicts by lowercased name', () => {
    const existing = new Map<string, EquityGrant>();
    existing.set('series b rsus', { id: 3, name: 'Series B RSUs' } as EquityGrant);
    const row = validateEquityGrantRow(
      validRaw(),
      0,
      ctx({ existingEquityGrantConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(3);
  });
});

describe('equityGrantTemplateCsv', () => {
  it('emits a CSV header with vesting_schedule_json', () => {
    const csv = equityGrantTemplateCsv();
    expect(csv).toContain('vesting_schedule_json');
    expect(csv).toContain('company_name');
  });
});
