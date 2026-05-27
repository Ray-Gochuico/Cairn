import { describe, it, expect } from 'vitest';
import { validatePropertyRow, propertyTemplateCsv } from '@/lib/import/validators/property';
import type { ValidationContext } from '@/lib/import/types';
import type { Property } from '@/types/schema';
import { PropertyType } from '@/types/enums';

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

describe('validatePropertyRow', () => {
  it('parses a minimal valid row', () => {
    const row = validatePropertyRow(
      {
        name: 'Main Residence',
        type: PropertyType.PRIMARY_RESIDENCE,
        current_estimated_value: '750000',
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.type).toBe(PropertyType.PRIMARY_RESIDENCE);
    expect(row.resolved.currentEstimatedValue).toBe(750000);
  });

  it('errors on missing required fields', () => {
    const row = validatePropertyRow({ name: '' }, 0, ctx());
    expect(row.errors.some((e) => e.field === 'name')).toBe(true);
    expect(row.errors.some((e) => e.field === 'type')).toBe(true);
    expect(row.errors.some((e) => e.field === 'current_estimated_value')).toBe(true);
  });

  it('errors on unknown type', () => {
    const row = validatePropertyRow(
      { name: 'X', type: 'CONDO', current_estimated_value: '100000' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('parses excluded_from_net_worth = "yes" as true', () => {
    const row = validatePropertyRow(
      {
        name: 'X',
        type: PropertyType.LAND,
        current_estimated_value: '0',
        excluded_from_net_worth: 'yes',
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.excludedFromNetWorth).toBe(true);
  });

  it('errors on bad excluded_from_net_worth value', () => {
    const row = validatePropertyRow(
      {
        name: 'X',
        type: PropertyType.LAND,
        current_estimated_value: '0',
        excluded_from_net_worth: 'maybe',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'excluded_from_net_worth')).toBe(true);
  });

  it('errors on bad purchase_date format', () => {
    const row = validatePropertyRow(
      {
        name: 'X',
        type: PropertyType.LAND,
        current_estimated_value: '0',
        purchase_date: '1/1/2020',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'purchase_date')).toBe(true);
  });

  it('resolves owner_person_name', () => {
    const row = validatePropertyRow(
      {
        name: 'X',
        type: PropertyType.LAND,
        current_estimated_value: '0',
        owner_person_name: 'alice',
      },
      0,
      ctx(),
    );
    expect(row.resolved.ownerPersonId).toBe(1);
  });

  it('detects conflicts by lowercased name', () => {
    const existing = new Map<string, Property>();
    existing.set('main residence', { id: 7, name: 'Main Residence' } as Property);
    const row = validatePropertyRow(
      {
        name: 'Main Residence',
        type: PropertyType.PRIMARY_RESIDENCE,
        current_estimated_value: '750000',
      },
      0,
      ctx({ existingPropertyConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(7);
  });
});

describe('propertyTemplateCsv', () => {
  it('emits a CSV header + at least one sample row', () => {
    const csv = propertyTemplateCsv();
    expect(csv).toContain('name');
    expect(csv).toContain('current_estimated_value');
  });
});
