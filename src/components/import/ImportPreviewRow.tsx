import { memo } from 'react';
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
  new: 'bg-success-soft text-success-foreground',
  update: 'bg-warning-soft text-warning-foreground',
  duplicate: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/15 text-destructive-soft-foreground',
};

const ROW_BG: Record<PreviewStatus, string> = {
  new: '',
  update: 'bg-warning-soft',
  duplicate: 'bg-muted',
  error: 'bg-destructive/10',
};

function formatExisting(existing: unknown): string {
  if (typeof existing === 'number') {
    return `$${existing.toLocaleString()}`;
  }
  return '—';
}

// React.memo so editing one cell re-renders only that row, not all of them.
// `onEdit`/`onDelete`/`onConflictChange` are stable zustand store actions and
// `accounts` is a stable ctx reference, so the default shallow compare is
// meaningful: a row only re-renders when its own `row`/`conflictMode` changes.
export const ImportPreviewRow = memo(function ImportPreviewRow({ row, accounts, conflictMode, onEdit, onDelete, onConflictChange }: Props) {
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
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatExisting(row.existing)}
      </td>
      <td className="px-3 py-2">
        {showsConflict ? (
          <select
            value={conflictMode}
            onChange={(e) => onConflictChange(row.rowId, e.target.value as 'update' | 'skip')}
            className="text-xs px-1.5 py-0.5 border border-input rounded w-full bg-transparent"
          >
            <option value="update">Update</option>
            <option value="skip">Skip</option>
          </select>
        ) : '—'}
      </td>
      <td className="px-2 py-2">
        <button
          aria-label="Remove row"
          className="text-muted-foreground hover:text-destructive text-sm"
          onClick={() => onDelete(row.rowId)}
        >×</button>
      </td>
    </tr>
  );
});
