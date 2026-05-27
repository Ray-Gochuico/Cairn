// src/lib/import/conflict-detector.ts
import type {
  Account,
  Holding,
  Loan,
  Property,
  Vehicle,
  EquityGrant,
  Contribution,
  AssetValueSnapshot,
} from '@/types/schema';

interface SnapshotKey {
  accountId: number;
  snapshotDate: string;
  totalValue: number;
}

interface TransactionKey {
  accountId: number;
  date: string;
  amount: number;
  merchant: string;
}

/**
 * Build a lookup map for snapshot UNIQUE conflict detection.
 * Key format: `${accountId}|${snapshotDate}` → existing totalValue.
 */
export function buildSnapshotConflictMap(
  snapshots: ReadonlyArray<SnapshotKey>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of snapshots) {
    m.set(`${s.accountId}|${s.snapshotDate}`, s.totalValue);
  }
  return m;
}

/**
 * Build a lookup set for transaction dedupe heuristic.
 * Key format: `${accountId}|${date}|${amount}|${lowercased+trimmed merchant}`.
 */
export function buildTransactionDuplicateKeys(
  transactions: ReadonlyArray<TransactionKey>,
): Set<string> {
  const s = new Set<string>();
  for (const t of transactions) {
    const merchantKey = t.merchant.trim().toLowerCase();
    s.add(`${t.accountId}|${t.date}|${t.amount}|${merchantKey}`);
  }
  return s;
}

/**
 * Build a lookup map for account name-collision detection during CSV import.
 * Key format: `${lowercased name}` → existing Account row.
 */
export function buildAccountConflictMap(
  accounts: ReadonlyArray<Account>,
): Map<string, Account> {
  const m = new Map<string, Account>();
  for (const a of accounts) m.set(a.name.toLowerCase(), a);
  return m;
}

/**
 * Build a lookup map for holding (accountId, ticker) collisions during import.
 * Key format: `${accountId}::${ticker}` → existing Holding row.
 */
export function buildHoldingConflictMap(
  holdings: ReadonlyArray<Holding>,
): Map<string, Holding> {
  const m = new Map<string, Holding>();
  for (const h of holdings) m.set(`${h.accountId}::${h.ticker}`, h);
  return m;
}

/**
 * Build a lookup map for loan name-collision detection during import.
 * Key format: `${lowercased name}` → existing Loan row.
 */
export function buildLoanConflictMap(
  loans: ReadonlyArray<Loan>,
): Map<string, Loan> {
  const m = new Map<string, Loan>();
  for (const l of loans) m.set(l.name.toLowerCase(), l);
  return m;
}

/**
 * Build a lookup map for property name-collision detection during import.
 * Key format: `${lowercased name}` → existing Property row.
 */
export function buildPropertyConflictMap(
  properties: ReadonlyArray<Property>,
): Map<string, Property> {
  const m = new Map<string, Property>();
  for (const p of properties) m.set(p.name.toLowerCase(), p);
  return m;
}

/**
 * Build a lookup map for vehicle name-collision detection during import.
 * Key format: `${lowercased name}` → existing Vehicle row.
 */
export function buildVehicleConflictMap(
  vehicles: ReadonlyArray<Vehicle>,
): Map<string, Vehicle> {
  const m = new Map<string, Vehicle>();
  for (const v of vehicles) m.set(v.name.toLowerCase(), v);
  return m;
}

/**
 * Build a lookup map for equity-grant name-collision detection during import.
 * Key format: `${lowercased name}` → existing EquityGrant row.
 */
export function buildEquityGrantConflictMap(
  grants: ReadonlyArray<EquityGrant>,
): Map<string, EquityGrant> {
  const m = new Map<string, EquityGrant>();
  for (const g of grants) m.set(g.name.toLowerCase(), g);
  return m;
}

/**
 * Build a lookup set for contribution dedupe heuristic during import.
 * Key format: `${accountId}::${date}::${amount}` (mirrors transactions).
 */
export function buildContributionDuplicateKeys(
  contribs: ReadonlyArray<Contribution>,
): Set<string> {
  const s = new Set<string>();
  for (const c of contribs) s.add(`${c.accountId}::${c.date}::${c.amount}`);
  return s;
}

/**
 * Build a lookup map for asset-value-snapshot UPDATE detection during import.
 * Key format: `${ownerType}::${ownerId}::${snapshotDate}` → existing snapshot.
 */
export function buildAssetValueSnapshotConflictMap(
  snaps: ReadonlyArray<AssetValueSnapshot>,
): Map<string, AssetValueSnapshot> {
  const m = new Map<string, AssetValueSnapshot>();
  for (const s of snaps) {
    m.set(`${s.ownerType}::${s.ownerId}::${s.snapshotDate}`, s);
  }
  return m;
}
