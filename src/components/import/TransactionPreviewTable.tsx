import { TransactionPreviewRow } from './TransactionPreviewRow';
import type { ImportPreviewState } from '@/stores/import-preview-store';

interface Props {
  state: ImportPreviewState<'transaction'>;
}

export function TransactionPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  const categories = state.ctx.categories ?? [];
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left w-32">Date</th>
            <th className="px-3 py-2 text-left">Account</th>
            <th className="px-3 py-2 text-right w-28">Amount</th>
            <th className="px-3 py-2 text-left">Merchant</th>
            <th className="px-3 py-2 text-left w-32">Category</th>
            <th className="px-3 py-2 text-left w-24">Reimb.</th>
            <th className="px-3 py-2 text-left w-24">Action</th>
            <th className="px-2 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {state.derivedRows.map((row) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
