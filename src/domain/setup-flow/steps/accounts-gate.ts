import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { SnapshotSource } from '@/types/enums';
import type { AccountScaffoldValues } from '@/lib/entity-scaffolds';

/**
 * The flow-specific accounts-gate write (spec rule 4). Steps 1+2 — create,
 * then persist the four collected chart answers, self-cleaning — now live in
 * the shared store action `createWithAnswers` (Wave A item 2, D-WA3), so
 * every UI entry path uses the same sequence. This gate keeps its OWN
 * snapshot step + rollback (behavior parity with the shipped m3 self-clean):
 *   1+2. store.createWithAnswers(values) — row + the four collected columns
 *   3.   snapshots.upsert MANUAL         — today's balance (only when entered)
 * MANUAL wins the snapshot upsert's source-aware conflict rule, so re-adding
 * the same date is safe.
 */
export async function createAccountWithBalance(
  values: AccountScaffoldValues,
  balance: number | null,
  todayIso: string,
): Promise<number> {
  // Steps 1+2 (create → persist collected answers, self-cleaning) now live
  // in the shared store action — every UI entry path uses the same sequence.
  const id = await useAccountsStore.getState().createWithAnswers(values);
  try {
    if (balance != null) {
      await useSnapshotsStore.getState().upsert({
        accountId: id, snapshotDate: todayIso, totalValue: balance, source: SnapshotSource.MANUAL,
      });
    }
  } catch (err) {
    // Review m3 parity: a snapshot failure still removes the created row so
    // a retry starts clean.
    try {
      await useAccountsStore.getState().remove(id);
    } catch {
      // The original failure is the one worth surfacing.
    }
    throw err;
  }
  return id;
}
