import { resolveVehicleRepairCategoryIds } from '@/lib/category-config';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';
import { AssetSnapshotOwnerType } from '@/types/enums';
import type { Category, Transaction } from '@/types/schema';
import type { InterviewContext } from '@/types/interview';

/** Registry constants (design §4.2) — the thresholds ARE the policy. */
export const CAR_AGE_YEARS_MIN = 10;
export const CAR_DECLINE_PCT_MIN = 15;
export const CAR_REPAIR_12M_MIN_DOLLARS = 1200;

export interface CarSignalEvaluation {
  branch: 'signal' | 'quiet' | 'unknown';
  facts: {
    vehicleId: number;
    /** null when Vehicle.year is null. */
    modelYear: number | null;
    ageYears: number | null;
    /** null when < 2 dated snapshots in the trailing 12 months. */
    declinePct: number | null;
    repair12mDollars: number;
    /** Multi-vehicle households: categorized-but-unlinked spend (CI-46b). */
    unattributedRepairDollars: number;
    /** Which signals fired — pinned into basis_json facts. */
    firing: ('age' | 'decline' | 'repairs')[];
    /** Trailing-12m current value for CI-43; null = not tracked (never $0). */
    currentValueDollars: number | null;
  };
}

function inWindow(dateIso: string, todayIso: string): boolean {
  const start = `${Number(todayIso.slice(0, 4)) - 1}${todayIso.slice(4)}`;
  return dateIso >= start && dateIso <= todayIso;
}

function repairSpend(
  ctx: InterviewContext,
  vehicleId: number,
  todayIso: string,
): { attributed: number; unattributed: number } {
  const repairIds = new Set(
    resolveVehicleRepairCategoryIds(ctx.settings?.vehicleRepairCategoryIds ?? null, ctx.categories ?? []),
  );
  if (repairIds.size === 0) return { attributed: 0, unattributed: 0 };
  const singleVehicle = ctx.vehicles.length === 1;
  const categoriesById = new Map<number, Category>();
  for (const c of ctx.categories ?? []) if (c.id != null) categoriesById.set(c.id, c);
  let attributed = 0;
  let unattributed = 0;
  for (const t of ctx.transactions as Transaction[]) {
    if (t.categoryId == null || !repairIds.has(t.categoryId)) continue;
    if (!inWindow(t.date, todayIso)) continue;
    if (!isRealSpending(t, categoriesById)) continue;
    const amount = effectiveSpendingAmount(t);
    if (t.vehicleId === vehicleId || (t.vehicleId == null && singleVehicle)) attributed += amount;
    else if (t.vehicleId == null) unattributed += amount;
  }
  return { attributed, unattributed };
}

/**
 * Three INDEPENDENT signals per vehicle (design §4.2), each absent-able:
 * age (model-years from Vehicle.year), observed decline (≥2 dated
 * AssetValueSnapshots in the trailing 12m — observation, no forecast),
 * repair spend (D-GI7 attribution). branch: any fired → 'signal';
 * all three data-absent → 'unknown'; else 'quiet'. Pure; ctx.today only.
 */
export function evaluateCarSignals(ctx: InterviewContext, vehicleId: number): CarSignalEvaluation {
  const todayIso = ctx.today.toISOString().slice(0, 10);
  const vehicle = ctx.vehicles.find((v) => v.id === vehicleId);
  const modelYear = vehicle?.year ?? null;
  const ageYears = modelYear == null ? null : ctx.today.getFullYear() - modelYear;

  const snaps = ctx.assetValueSnapshots
    .filter((s) => s.ownerType === AssetSnapshotOwnerType.VEHICLE && s.ownerId === vehicleId)
    .filter((s) => inWindow(s.snapshotDate, todayIso))
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  let declinePct: number | null = null;
  if (snaps.length >= 2 && snaps[0].value > 0) {
    const raw = ((snaps[0].value - snaps[snaps.length - 1].value) / snaps[0].value) * 100;
    declinePct = Math.round(raw * 10) / 10;
  }

  const { attributed, unattributed } = repairSpend(ctx, vehicleId, todayIso);

  const firing: CarSignalEvaluation['facts']['firing'] = [];
  if (ageYears != null && ageYears >= CAR_AGE_YEARS_MIN) firing.push('age');
  if (declinePct != null && declinePct >= CAR_DECLINE_PCT_MIN) firing.push('decline');
  if (attributed >= CAR_REPAIR_12M_MIN_DOLLARS) firing.push('repairs');

  const latestSnap = snaps.length > 0 ? snaps[snaps.length - 1].value : null;
  const currentValueDollars = latestSnap ?? vehicle?.currentEstimatedValue ?? null;

  const ageAbsent = modelYear == null;
  const declineAbsent = declinePct == null;
  const repairsAbsent = attributed === 0 && unattributed === 0;
  const branch: CarSignalEvaluation['branch'] =
    firing.length > 0 ? 'signal' : ageAbsent && declineAbsent && repairsAbsent ? 'unknown' : 'quiet';

  return {
    branch,
    facts: {
      vehicleId, modelYear, ageYears, declinePct,
      repair12mDollars: attributed,
      unattributedRepairDollars: unattributed,
      firing, currentValueDollars,
    },
  };
}
