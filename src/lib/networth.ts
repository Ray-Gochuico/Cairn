import { monthsBetween } from './business-days';

export interface SnapshotPoint { accountId: number; snapshotMonth: string; totalValue: number; }
export interface PropertyAsset { id: number; currentEstimatedValue: number | null; excludedFromNetWorth: boolean; }
export interface VehicleAsset { id: number; currentEstimatedValue: number | null; excludedFromNetWorth: boolean; }
export interface LoanLiability { id: number; currentBalance: number; }

export interface NetWorthInput {
  snapshots: SnapshotPoint[];
  properties: PropertyAsset[];
  vehicles: VehicleAsset[];
  loans: LoanLiability[];
}

export function netWorthForMonth(month: string, input: NetWorthInput): number {
  // Latest snapshot per account at or before this month
  const byAccount = new Map<number, SnapshotPoint>();
  for (const s of input.snapshots) {
    if (s.snapshotMonth > month) continue;
    const existing = byAccount.get(s.accountId);
    if (!existing || existing.snapshotMonth < s.snapshotMonth) byAccount.set(s.accountId, s);
  }
  const accountTotal = [...byAccount.values()].reduce((a, b) => a + b.totalValue, 0);
  const propertyTotal = input.properties
    .filter((p) => !p.excludedFromNetWorth)
    .reduce((a, b) => a + (b.currentEstimatedValue ?? 0), 0);
  const vehicleTotal = input.vehicles
    .filter((v) => !v.excludedFromNetWorth)
    .reduce((a, b) => a + (b.currentEstimatedValue ?? 0), 0);
  const debt = input.loans.reduce((a, b) => a + b.currentBalance, 0);
  return accountTotal + propertyTotal + vehicleTotal - debt;
}

export function netWorthSeries(from: string, to: string, input: NetWorthInput) {
  return monthsBetween(from, to).map((month) => ({
    month,
    netWorth: netWorthForMonth(month, input),
  }));
}
