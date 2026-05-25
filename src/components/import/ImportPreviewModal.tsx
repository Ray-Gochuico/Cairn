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
import { commitSnapshotImport } from '@/lib/import/commit';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { getDatabase } from '@/db/db';
import type { ImportEntity, ValidationContext } from '@/lib/import/types';

interface Props {
  entity: ImportEntity;
  parsed: ParseResultLite;
  ctx: ValidationContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportPreviewModal({ entity, parsed, ctx, open, onOpenChange }: Props) {
  const storeRef = useMemo(
    () => createImportPreviewStore(entity, parsed, ctx),
    [entity, parsed, ctx],
  );
  const state = useStore(storeRef);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const loadSnapshots = useSnapshotsStore((s) => s.load);

  const committableCount = state.summary.new + state.summary.update;
  const commitDisabled =
    state.summary.error > 0 || committableCount === 0 || committing;

  const onCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      if (entity === 'snapshot') {
        const snapshotState = state as unknown as ImportPreviewState<'snapshot'>;
        const rows = snapshotState.committableRows();
        const db = getDatabase();
        await commitSnapshotImport(rows, {
          db,
          snapshots: new AccountSnapshotsRepo(db),
        });
        await loadSnapshots();
      }
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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

        {entity === 'snapshot' && (
          <>
            <SummaryBar state={state as unknown as ImportPreviewState<'snapshot'>} />
            <div className="max-h-[55vh] overflow-y-auto">
              <ImportPreviewTable state={state as unknown as ImportPreviewState<'snapshot'>} />
            </div>
          </>
        )}

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

function SummaryBar({ state }: { state: ImportPreviewState<'snapshot'> }) {
  return (
    <div className="flex gap-2 items-center text-xs flex-wrap">
      <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
        {state.summary.new} new
      </span>
      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
        {state.summary.update} update
      </span>
      {state.summary.duplicate > 0 && (
        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
          {state.summary.duplicate} duplicate
        </span>
      )}
      <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
        {state.summary.error} error{state.summary.error === 1 ? '' : 's'}
      </span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('update')}>
          Update all
        </Button>
        <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('skip')}>
          Skip all
        </Button>
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
