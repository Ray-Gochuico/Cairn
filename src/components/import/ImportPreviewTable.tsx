import { ImportPreviewRow } from './ImportPreviewRow';
import { VirtualizedPreviewTable, PreviewEmptyState } from './VirtualizedPreviewTable';
import type { ImportPreviewState } from '@/stores/import-preview-store';

interface Props {
  state: ImportPreviewState<'snapshot'>;
}

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left">Account</th>
    <th className="px-3 py-2 text-left w-32">Date</th>
    <th className="px-3 py-2 text-right w-32">Value</th>
    <th className="px-3 py-2 text-right w-32">Existing</th>
    <th className="px-3 py-2 text-left w-28">Action</th>
    <th className="px-2 py-2 w-8" />
  </>
);

export function ImportPreviewTable({ state }: Props) {
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={7}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <ImportPreviewRow
          key={row.rowId}
          row={row}
          accounts={state.ctx.accounts}
          conflictMode={
            state.conflictMode.get(row.rowId)
            ?? (row.status === 'duplicate' ? 'skip' : 'update')
          }
          onEdit={state.edit}
          onDelete={state.delete}
          onConflictChange={state.setConflictMode}
        />
      )}
    />
  );
}
