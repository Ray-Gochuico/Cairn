import { describe, it, expect } from 'vitest';
import {
  validateAssetValueSnapshotRow,
  assetValueSnapshotTemplateCsv,
} from '@/lib/import/validators/asset-value-snapshot';
import type { ValidationContext } from '@/lib/import/types';
import type { AssetValueSnapshot } from '@/types/schema';
import { AssetSnapshotOwnerType } from '@/types/enums';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [],
    persons: [],
    categories: [],
    properties: [{ id: 5, name: 'Main Residence' }],
    vehicles: [{ id: 9, name: 'Daily Driver' }],
    ...overrides,
  };
}

describe('validateAssetValueSnapshotRow', () => {
  it('parses a minimal valid property row', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Main Residence',
        snapshot_date: '2026-04-30',
        value: '765000',
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.ownerId).toBe(5);
    expect(row.resolved.ownerType).toBe(AssetSnapshotOwnerType.PROPERTY);
  });

  it('parses a vehicle row', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.VEHICLE,
        owner_name: 'Daily Driver',
        snapshot_date: '2026-04-30',
        value: '16500',
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.ownerId).toBe(9);
  });

  it('errors when owner_type=PROPERTY but owner_name matches only a vehicle', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Daily Driver',
        snapshot_date: '2026-04-30',
        value: '16500',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'owner_name')).toBe(true);
  });

  it('errors on unknown owner_type', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: 'BAD',
        owner_name: 'X',
        snapshot_date: '2026-04-30',
        value: '0',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'owner_type')).toBe(true);
  });

  it('errors on bad date format', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Main Residence',
        snapshot_date: '4/30/2026',
        value: '0',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'snapshot_date')).toBe(true);
  });

  it('errors on negative value', () => {
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Main Residence',
        snapshot_date: '2026-04-30',
        value: '-1',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'value')).toBe(true);
  });

  it('detects conflicts as status=update', () => {
    const existing = new Map<string, AssetValueSnapshot>();
    existing.set('PROPERTY::5::2026-04-30', {
      id: 11,
      ownerType: AssetSnapshotOwnerType.PROPERTY,
      ownerId: 5,
      snapshotDate: '2026-04-30',
      value: 750000,
    });
    const row = validateAssetValueSnapshotRow(
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Main Residence',
        snapshot_date: '2026-04-30',
        value: '765000',
      },
      0,
      ctx({ existingAssetValueSnapshotConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(11);
  });
});

describe('assetValueSnapshotTemplateCsv', () => {
  it('emits a CSV header with owner_type', () => {
    const csv = assetValueSnapshotTemplateCsv();
    expect(csv).toContain('owner_type');
    expect(csv).toContain('snapshot_date');
  });
});
