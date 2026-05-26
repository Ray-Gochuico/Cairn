import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  createImportPreviewStore,
  type ImportPreviewState,
  type ParseResultLite,
} from '@/stores/import-preview-store';
import { ImportPreviewTable } from './ImportPreviewTable';
import { TransactionPreviewTable } from './TransactionPreviewTable';
import { commitSnapshotImport, commitTransactionImport } from '@/lib/import/commit';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { TransactionsRepo } from '@/domain/transactions';
import { getDatabase } from '@/db/db';
import type { ImportEntity, ValidationContext } from '@/lib/import/types';

interface Props {
  entity: ImportEntity;
  parsed: ParseResultLite;
  ctx: ValidationContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown as "File {current} of {total}" subtitle when total > 1. Omit for single-file callers. */
  queuePosition?: { current: number; total: number };
  /**
   * Called after a successful import. Receives the row count just inserted.
   * When provided, the modal does NOT auto-close — the caller is in charge
   * of advancing or closing (used by the multi-file queue to advance to the
   * next file without flicker). When absent, the modal auto-closes via
   * `onOpenChange(false)` as today.
   */
  onSaved?: (insertedCount: number) => void;
}

export function ImportPreviewModal({
  entity,
  parsed,
  ctx,
  open,
  onOpenChange,
  queuePosition,
  onSaved,
}: Props) {
  const storeRef = useMemo(
    () => createImportPreviewStore(entity, parsed, ctx),
    [entity, parsed, ctx],
  );
  const state = useStore(storeRef);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const household = useHouseholdStore((s) => s.household);

  const commitDisabled =
    state.summary.error > 0
    || state.committableRows().length === 0
    || committing;

  const onCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const db = getDatabase();
      let insertedCount = 0;
      if (entity === 'snapshot') {
        const snapshotState = state as unknown as ImportPreviewState<'snapshot'>;
        const rows = snapshotState.committableRows();
        const result = await commitSnapshotImport(rows, {
          db,
          snapshots: new AccountSnapshotsRepo(db),
        });
        insertedCount = result?.inserted ?? rows.length;
        await loadSnapshots();
      } else {
        const transactionState = state as unknown as ImportPreviewState<'transaction'>;
        const rows = transactionState.committableRows();
        const result = await commitTransactionImport(rows, {
          db,
          transactions: new TransactionsRepo(db),
          householdId: household?.id ?? 1,
        });
        insertedCount = result?.inserted ?? rows.length;
        await loadTransactions();
      }
      if (onSaved) {
        onSaved(insertedCount);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const title =
    entity === 'snapshot'
      ? 'Import account snapshots from CSV'
      : 'Import transactions from CSV';

  const committableCount = state.committableRows().length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {queuePosition && queuePosition.total > 1 && (
            <div className="text-xs text-muted-foreground">
              File {queuePosition.current} of {queuePosition.total}
            </div>
          )}
          <div className="text-xs text-slate-500">
            {parsed.rows.length} rows parsed
            {parsed.errors.length > 0 && (
              <span className="text-red-700 ml-2">
                · {parsed.errors.length} lines could not be parsed
              </span>
            )}
          </div>
        </DialogHeader>

        {parsed.errors.length > 0 && (
          <div className="text-xs text-red-700 italic bg-red-50 border border-red-200 rounded p-2">
            {parsed.errors.length} lines could not be parsed (line{' '}
            {parsed.errors.map((e) => e.line).join(', ')}). Fix and re-upload.
          </div>
        )}

        <SummaryBar
          state={state as unknown as ImportPreviewState<'snapshot' | 'transaction'>}
          entity={entity}
        />
        <div className="max-h-[55vh] overflow-y-auto">
          {entity === 'snapshot' ? (
            <ImportPreviewTable state={state as unknown as ImportPreviewState<'snapshot'>} />
          ) : (
            <TransactionPreviewTable state={state as unknown as ImportPreviewState<'transaction'>} />
          )}
        </div>

        {commitError && (
          <div className="text-xs text-red-700 italic bg-red-50 border border-red-200 rounded p-2">
            Commit failed: {commitError}
          </div>
        )}

        <DialogFooter>
          {state.summary.error > 0 && (
            <div className="text-xs text-red-700 mr-auto self-center">
              Resolve {state.summary.error} error
              {state.summary.error === 1 ? '' : 's'} before committing
            </div>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={commitDisabled} onClick={onCommit}>
            {committing ? 'Committing…' : `Commit (${committableCount} rows)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryBar({
  state,
  entity,
}: {
  state: ImportPreviewState<'snapshot' | 'transaction'>;
  entity: ImportEntity;
}) {
  return (
    <div className="flex gap-2 items-center text-xs flex-wrap">
      <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
        {state.summary.new} new
      </span>
      {state.summary.update > 0 && (
        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
          {state.summary.update} update
        </span>
      )}
      {state.summary.duplicate > 0 && (
        <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
          {state.summary.duplicate} duplicate
        </span>
      )}
      <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
        {state.summary.error} error{state.summary.error === 1 ? '' : 's'}
      </span>
      <div className="ml-auto flex gap-2">
        {entity === 'snapshot' && (
          <>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('update')}>
              Update all
            </Button>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('skip')}>
              Skip all
            </Button>
          </>
        )}
        {entity === 'transaction' && state.summary.duplicate > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('update')}>
              Insert all duplicates
            </Button>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('skip')}>
              Skip all duplicates
            </Button>
          </>
        )}
        {state.summary.error > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="text-red-700"
            onClick={() => state.deleteAllErrors()}
          >
            Delete errors
          </Button>
        )}
      </div>
    </div>
  );
}
