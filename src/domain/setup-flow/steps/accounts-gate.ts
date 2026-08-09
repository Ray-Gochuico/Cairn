import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { SnapshotSource } from '@/types/enums';
import type { AccountScaffoldValues } from '@/lib/entity-scaffolds';

/**
 * The flow-specific accounts-gate write (spec rule 4): NO existing component
 * does create-then-update, and every existing create path silently drops the
 * match answers (the store nulls them). Sequence, strictly awaited (D-WF14):
 *   1. store.create(values)              — the row (match columns null)
 *   2. store.update(id, match columns)   — persists hasEmployerMatch/pct/limit
 *   3. snapshots.upsert MANUAL           — today's balance (only when entered)
 * MANUAL wins the snapshot upsert's source-aware conflict rule, so re-adding
 * the same date is safe.
 */
export async function createAccountWithBalance(
  values: AccountScaffoldValues,
  balance: number | null,
  todayIso: string,
): Promise<number> {
  const id = await useAccountsStore.getState().create(values);
  await useAccountsStore.getState().update(id, {
    hasEmployerMatch: values.hasEmployerMatch,
    employerMatchPct: values.employerMatchPct,
    employerMatchLimitPct: values.employerMatchLimitPct,
  });
  if (balance != null) {
    await useSnapshotsStore.getState().upsert({
      accountId: id, snapshotDate: todayIso, totalValue: balance, source: SnapshotSource.MANUAL,
    });
  }
  return id;
}
