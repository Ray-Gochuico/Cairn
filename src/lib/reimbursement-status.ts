import { formatCurrencyCents, formatDate } from '@/lib/format';
import type { Transaction } from '@/types/schema';

/**
 * v1.7.1 R10 (chip A-10a): the one reading of a transaction's reimbursement
 * state, shared by the row editor's status line (R2) and the marker in the
 * two Spending lists. It reads the SAVED row, and `reimbursable` gates it: a
 * row that is not reimbursable has no state, whatever its reimbursed_*
 * columns hold. (The editor clears those columns when Reimbursable is
 * unchecked — D-R10-3 — but a row saved before v1.7.1 can still carry them,
 * and every spending consumer ignores them there: isRealSpending /
 * effectiveSpendingAmount in src/lib/spending-analysis.ts.)
 */
export type ReimbursementState = 'reimbursed' | 'awaiting';

type ReimbursementFields = Pick<Transaction, 'reimbursable' | 'reimbursedAt' | 'reimbursedAmount'>;

export function reimbursementState(
  t: Pick<Transaction, 'reimbursable' | 'reimbursedAt'>,
): ReimbursementState | null {
  if (!t.reimbursable) return null;
  return t.reimbursedAt == null ? 'awaiting' : 'reimbursed';
}

/** The list marker. Byte-exact copy: CR-R10-A / CR-R10-B. */
export function reimbursementMarker(
  t: Pick<Transaction, 'reimbursable' | 'reimbursedAt'>,
): 'Reimbursed' | 'Awaiting' | null {
  const state = reimbursementState(t);
  if (state === 'reimbursed') return 'Reimbursed';
  if (state === 'awaiting') return 'Awaiting';
  return null;
}

/**
 * The row editor's status line (R2, chip task_32707759; moved here from
 * TransactionEditDialog in v1.7.1 R10, body unchanged). Byte-exact copy:
 * CR-R2-1 / CR-R2-2 / CR-R2-3.
 */
export function reimbursementStatusLine(t: ReimbursementFields): string | null {
  if (!t.reimbursable) return null;
  if (t.reimbursedAt == null) return 'Awaiting reimbursement.';
  if (t.reimbursedAmount == null) return `Reimbursed on ${formatDate(t.reimbursedAt)}.`;
  return `Reimbursed ${formatCurrencyCents(t.reimbursedAmount)} on ${formatDate(t.reimbursedAt)}.`;
}
