import { describe, it, expect } from 'vitest';
import { validateVehicleRow, vehicleTemplateCsv } from '@/lib/import/validators/vehicle';
import type { ValidationContext } from '@/lib/import/types';
import type { Vehicle } from '@/types/schema';

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

describe('validateVehicleRow', () => {
  it('parses a minimal valid row', () => {
    const row = validateVehicleRow(
      { name: 'Daily', current_estimated_value: '18000' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.currentEstimatedValue).toBe(18000);
  });

  it('errors on missing required fields', () => {
    const row = validateVehicleRow({ name: '', current_estimated_value: '' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'name')).toBe(true);
    expect(row.errors.some((e) => e.field === 'current_estimated_value')).toBe(true);
  });

  it('errors on bad year', () => {
    const row = validateVehicleRow(
      { name: 'X', current_estimated_value: '10000', year: '99' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'year')).toBe(true);
  });

  it('parses excluded_from_net_worth = "1" as true', () => {
    const row = validateVehicleRow(
      {
        name: 'X',
        current_estimated_value: '10000',
        excluded_from_net_worth: '1',
      },
      0,
      ctx(),
    );
    expect(row.resolved.excludedFromNetWorth).toBe(true);
  });

  it('detects conflicts by lowercased name', () => {
    const existing = new Map<string, Vehicle>();
    existing.set('daily', { id: 9, name: 'Daily' } as Vehicle);
    const row = validateVehicleRow(
      { name: 'Daily', current_estimated_value: '18000' },
      0,
      ctx({ existingVehicleConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(9);
  });
});

describe('vehicleTemplateCsv', () => {
  it('emits a CSV header + at least one sample row', () => {
    const csv = vehicleTemplateCsv();
    expect(csv).toContain('name');
    expect(csv).toContain('current_estimated_value');
  });
});
