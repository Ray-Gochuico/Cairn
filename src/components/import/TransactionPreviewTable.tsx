import { TransactionPreviewRow } from './TransactionPreviewRow';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import type { ImportPreviewState } from '@/stores/import-preview-store';

interface Props {
  state: ImportPreviewState<'transaction'>;
}

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left w-32">Date</th>
    <th className="px-3 py-2 text-left">Account</th>
    <th className="px-3 py-2 text-right w-28">Amount</th>
    <th className="px-3 py-2 text-left">Merchant</th>
    <th className="px-3 py-2 text-left w-32">Category</th>
    <th className="px-3 py-2 text-left w-24">Reimb.</th>
    <th className="px-3 py-2 text-left w-24">Action</th>
    <th className="px-2 py-2 w-8" />
  </>
);

export function TransactionPreviewTable({ state }: Props) {
  const categories = state.ctx.categories ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={9}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <TransactionPreviewRow
          key={row.rowId}
          row={row}
          accounts={state.ctx.accounts}
          categories={categories}
          conflictMode={state.conflictMode.get(row.rowId) ?? 'skip'}
          onEdit={state.edit}
          onDelete={state.delete}
          onConflictChange={state.setConflictMode}
        />
      )}
    />
  );
}
