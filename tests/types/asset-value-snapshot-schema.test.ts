import { describe, it, expect } from 'vitest';
import { AssetValueSnapshotSchema } from '@/types/schema';
import { AssetSnapshotOwnerType } from '@/types/enums';

describe('AssetValueSnapshotSchema', () => {
  it('parses a valid PROPERTY snapshot', () => {
    const out = AssetValueSnapshotSchema.parse({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-05-26',
      value: 450000,
    });
    expect(out.ownerType).toBe('PROPERTY');
    expect(out.ownerId).toBe(1);
    expect(out.snapshotDate).toBe('2026-05-26');
    expect(out.value).toBe(450000);
  });

  it('parses a valid VEHICLE snapshot', () => {
    const out = AssetValueSnapshotSchema.parse({
      ownerType: 'VEHICLE',
      ownerId: 7,
      snapshotDate: '2026-01-01',
      value: 22000,
    });
    expect(out.ownerType).toBe('VEHICLE');
  });

  it('accepts an optional id', () => {
    const out = AssetValueSnapshotSchema.parse({
      id: 42,
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-05-26',
      value: 100,
    });
    expect(out.id).toBe(42);
  });

  it('rejects negative values', () => {
    expect(() =>
      AssetValueSnapshotSchema.parse({
        ownerType: 'VEHICLE',
        ownerId: 1,
        snapshotDate: '2026-05-26',
        value: -1,
      }),
    ).toThrow();
  });

  it('rejects invalid dates', () => {
    expect(() =>
      AssetValueSnapshotSchema.parse({
        ownerType: 'VEHICLE',
        ownerId: 1,
        snapshotDate: '2026/05/26',
        value: 100,
      }),
    ).toThrow();
  });

  it('rejects unknown ownerType', () => {
    expect(() =>
      AssetValueSnapshotSchema.parse({
        ownerType: 'ACCOUNT',
        ownerId: 1,
        snapshotDate: '2026-05-26',
        value: 100,
      }),
    ).toThrow();
  });

  it('rejects non-positive ownerId', () => {
    expect(() =>
      AssetValueSnapshotSchema.parse({
        ownerType: 'PROPERTY',
        ownerId: 0,
        snapshotDate: '2026-05-26',
        value: 100,
      }),
    ).toThrow();
  });

  it('AssetSnapshotOwnerType enum exposes PROPERTY and VEHICLE values', () => {
    expect(AssetSnapshotOwnerType.PROPERTY).toBe('PROPERTY');
    expect(AssetSnapshotOwnerType.VEHICLE).toBe('VEHICLE');
  });
});
