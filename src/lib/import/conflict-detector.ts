// src/lib/import/conflict-detector.ts

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
