import { AccountCell } from './AccountCell';
import { DateCell } from './DateCell';
import { ValueCell } from './ValueCell';
import type { PreviewRow, PreviewStatus, RowId, RawRow } from '@/lib/import/types';
import type { SnapshotResolved } from '@/lib/import/validators/snapshot-validator';

interface Props {
  row: PreviewRow<SnapshotResolved>;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  conflictMode: 'update' | 'skip';
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
  onConflictChange: (rowId: RowId, mode: 'update' | 'skip') => void;
}

const STATUS_BADGE: Record<PreviewStatus, string> = {
  new: 'bg-emerald-100 text-emerald-800',
  update: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-800',
};

const ROW_BG: Record<PreviewStatus, string> = {
  new: '',
  update: 'bg-amber-50',
  duplicate: 'bg-slate-50',
  error: 'bg-red-50',
};

function formatExisting(existing: unknown): string {
  if (typeof existing === 'number') {
    return `$${existing.toLocaleString()}`;
  }
  return '—';
}

export function ImportPreviewRow({ row, accounts, conflictMode, onEdit, onDelete, onConflictChange }: Props) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
  const showsConflict = row.status === 'update' || row.status === 'duplicate';
  return (
    <tr className={ROW_BG[row.status]}>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
          {row.status.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2">
        <AccountCell
          value={row.raw.account ?? ''}
          error={err('account')}
          accounts={accounts}
          onChange={(name) => onEdit(row.rowId, { account: name })}
        />
      </td>
      <td className="px-3 py-2">
        <DateCell
          value={row.raw.snapshot_date ?? ''}
          error={err('snapshot_date')}
          onChange={(d) => onEdit(row.rowId, { snapshot_date: d })}
        />
      </td>
      <td className="px-3 py-2">
        <ValueCell
          value={row.raw.total_value ?? ''}
          error={err('total_value')}
          onChange={(v) => onEdit(row.rowId, { total_value: v })}
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
        {formatExisting(row.existing)}
      </td>
      <td className="px-3 py-2">
        {showsConflict ? (
          <select
            value={conflictMode}
            onChange={(e) => onConflictChange(row.rowId, e.target.value as 'update' | 'skip')}
            className="text-xs px-1.5 py-0.5 border border-slate-300 rounded w-full"
          >
            <option value="update">Update</option>
            <option value="skip">Skip</option>
          </select>
        ) : '—'}
      </td>
      <td className="px-2 py-2">
        <button
          aria-label="Remove row"
          className="text-slate-400 hover:text-red-600 text-sm"
          onClick={() => onDelete(row.rowId)}
        >×</button>
      </td>
    </tr>
  );
}
