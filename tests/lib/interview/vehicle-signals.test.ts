import { describe, it, expect } from 'vitest';
import { evaluateCarSignals } from '@/lib/interview/vehicle-signals';
import { AssetSnapshotOwnerType } from '@/types/enums';
import { makeVehicle } from '../../factories';
import { fixtureCtx } from './fixture';

const CATS = [
  { id: 2, name: 'Vehicles', parentCategoryId: null, type: 'NEED' },
  { id: 18, name: 'Vehicle Maintenance', parentCategoryId: 2, type: 'NEED' },
  { id: 21, name: 'Major Repairs', parentCategoryId: 2, type: 'NEED' },
] as never[];
const tx = (date: string, amount: number, categoryId: number, vehicleId: number | null) =>
  ({ date, amount, categoryId, vehicleId, reimbursable: false, reimbursedAt: null } as never);

const vsnap = (ownerId: number, snapshotDate: string, value: number) =>
  ({ ownerType: AssetSnapshotOwnerType.VEHICLE, ownerId, snapshotDate, value } as never);

describe('evaluateCarSignals — three independent signals (design §4.2)', () => {
  it('age: model-year ≥ 10 fires; null year keeps the signal silently absent', () => {
    const ctx = fixtureCtx({ vehicles: [makeVehicle({ id: 1, year: 2014 })], categories: CATS });
    const r = evaluateCarSignals(ctx, 1);
    expect(r.branch).toBe('signal');
    expect(r.facts.modelYear).toBe(2014); // 2026 − 2014 = 12 ≥ 10
    const noYear = evaluateCarSignals(
      fixtureCtx({ vehicles: [makeVehicle({ id: 1, year: null })], categories: CATS }), 1);
    expect(noYear.facts.modelYear).toBeNull();
  });

  it('decline: ≥ 15% over trailing 12m with ≥ 2 dated snapshots (20% here)', () => {
    const ctx = fixtureCtx({
      vehicles: [makeVehicle({ id: 1, year: 2024 })],
      assetValueSnapshots: [vsnap(1, '2025-09-15', 20000), vsnap(1, '2026-07-15', 16000)],
      categories: CATS,
    });
    const r = evaluateCarSignals(ctx, 1);
    expect(r.branch).toBe('signal');
    expect(r.facts.declinePct).toBe(20);
    // One snapshot → silent:
    const one = evaluateCarSignals(fixtureCtx({
      vehicles: [makeVehicle({ id: 1, year: 2024 })],
      assetValueSnapshots: [vsnap(1, '2026-07-15', 16000)], categories: CATS,
    }), 1);
    expect(one.facts.declinePct).toBeNull();
  });

  it('repairs (D-GI7): categorized + (linked OR single-vehicle-unlinked); ≥ $1,200 fires', () => {
    const ctx = fixtureCtx({
      vehicles: [makeVehicle({ id: 1, year: 2024 })],
      categories: CATS,
      transactions: [
        tx('2026-05-01', 900, 18, 1),      // linked + categorized → counts
        tx('2026-06-01', 950, 21, null),   // unlinked, single vehicle → counts
        tx('2024-01-01', 5000, 18, 1),     // out of window
        tx('2026-06-15', 400, 2, 1),       // parent 'Vehicles' ≠ repair child → no
      ],
    });
    const r = evaluateCarSignals(ctx, 1);
    expect(r.facts.repair12mDollars).toBe(1850);
    expect(r.branch).toBe('signal');
  });

  it('repairs, multi-vehicle: unlinked spend is UNATTRIBUTED (CI-46b), not counted', () => {
    const ctx = fixtureCtx({
      vehicles: [makeVehicle({ id: 1, year: 2024 }), makeVehicle({ id: 2, year: 2023 })],
      categories: CATS,
      transactions: [tx('2026-06-01', 1500, 18, null)],
    });
    const r = evaluateCarSignals(ctx, 1);
    expect(r.facts.repair12mDollars).toBe(0);
    expect(r.facts.unattributedRepairDollars).toBe(1500);
    expect(r.branch).toBe('quiet'); // age/decline/repairs all computable-but-quiet or absent → quiet
  });

  it('unknown: year null, <2 snapshots, zero repair transactions → the thread never surfaces', () => {
    const ctx = fixtureCtx({ vehicles: [makeVehicle({ id: 1, year: null })], categories: CATS });
    expect(evaluateCarSignals(ctx, 1).branch).toBe('unknown');
  });
});
