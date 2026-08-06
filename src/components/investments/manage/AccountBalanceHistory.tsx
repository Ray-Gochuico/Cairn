import { useEffect, useMemo } from 'react';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';

/**
 * Wave C (C7/IN-G5): per-account snapshot history with row delete. Account
 * snapshots were CREATE-ONLY — useSnapshotsStore.remove had zero UI callers,
 * so a fat-fingered balance on a wrong date was uncorrectable except by
 * overwriting the same (account, date). Mirrors the ValueHistorySection
 * pattern that property/vehicle snapshots already enjoy.
 */
export default function AccountBalanceHistory({
  accountId,
  accountName,
}: {
  accountId: number;
  accountName: string;
}) {
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const load = useSnapshotsStore((s) => s.load);
  const remove = useSnapshotsStore((s) => s.remove);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    void load(); // deduped store load — the Manage surface owns hydration
  }, [load]);

  const entries = useMemo(
    () =>
      snapshots
        .filter((s) => s.accountId === accountId)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)),
    [snapshots, accountId],
  );

  return (
    <details className="mt-2 rounded-md border bg-card">
      <summary className="cursor-pointer px-3 py-1.5 text-sm hover:bg-muted/40">
        Balance history ({entries.length})
      </summary>
      <div className="p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No snapshots yet — record one with Update balance.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {entries.map((s) => (
              <li
                key={s.id}
                data-testid={`balance-history-row-${accountId}-${s.snapshotDate}`}
                className="flex flex-wrap items-center gap-2 border-b py-1 last:border-b-0"
              >
                <span className="w-28 font-mono text-xs tabular-nums text-muted-foreground">
                  {s.snapshotDate}
                </span>
                <span className="flex-1 font-mono tabular-nums">{formatCurrency(s.totalValue)}</span>
                <span className="text-xs text-muted-foreground">
                  {s.source.toLowerCase().replace(/_/g, ' ')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Delete ${accountName} snapshot ${s.snapshotDate}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Delete this balance snapshot?',
                      description: `Removes ${accountName}’s ${formatDate(s.snapshotDate)} balance from history. Charts and monthly aggregates recompute without it. This can’t be undone.`,
                    });
                    if (ok && s.id != null) await remove(s.id);
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialog}
    </details>
  );
}
