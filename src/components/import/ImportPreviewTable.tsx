import { ImportPreviewRow } from './ImportPreviewRow';
import type { ImportPreviewState } from '@/stores/import-preview-store';

interface Props {
  state: ImportPreviewState<'snapshot'>;
}

export function ImportPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left">Account</th>
            <th className="px-3 py-2 text-left w-32">Date</th>
            <th className="px-3 py-2 text-right w-32">Value</th>
            <th className="px-3 py-2 text-right w-32">Existing</th>
            <th className="px-3 py-2 text-left w-28">Action</th>
            <th className="px-2 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {state.derivedRows.map((row) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
