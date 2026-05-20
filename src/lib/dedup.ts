/**
 * Minimal shape for duplicate detection. Both parsed candidates and existing
 * transaction rows expose these three fields. `source_account_id` is part of
 * the spec's dedup tuple but is null for every PDF import, so it is omitted.
 */
export interface Dedupable {
  date: string;
  amount: number;
  merchantRaw: string | null;
}

/** Stable key over (date, amount, uppercased merchantRaw). */
export function transactionDedupKey(t: Dedupable): string {
  return `${t.date}|${t.amount.toFixed(2)}|${(t.merchantRaw ?? '').toUpperCase().trim()}`;
}

/**
 * Partition `candidates` into rows not seen in `existing` (fresh) and rows
 * that are (duplicates). Also dedups within the candidate batch — a PDF that
 * lists the same charge twice yields one fresh row.
 */
export function filterDuplicates<T extends Dedupable>(
  candidates: T[],
  existing: Dedupable[],
): { fresh: T[]; duplicates: T[] } {
  const seen = new Set(existing.map(transactionDedupKey));
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const c of candidates) {
    const key = transactionDedupKey(c);
    if (seen.has(key)) {
      duplicates.push(c);
    } else {
      fresh.push(c);
      seen.add(key);
    }
  }
  return { fresh, duplicates };
}
