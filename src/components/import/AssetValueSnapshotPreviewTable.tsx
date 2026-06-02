import { memo } from 'react';
import { EnumCell } from './EnumCell';
import { DateCell } from './DateCell';
import { VirtualizedPreviewTable, PreviewEmptyState } from './VirtualizedPreviewTable';
import { AssetSnapshotOwnerType } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { AssetValueSnapshotResolved } from '@/lib/import/validators/asset-value-snapshot';

interface Props {
  state: ImportPreviewState<'asset_value_snapshot'>;
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

const OWNER_TYPE_OPTIONS = Object.values(AssetSnapshotOwnerType);

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left w-32">Owner type</th>
    <th className="px-3 py-2 text-left">Owner name</th>
    <th className="px-3 py-2 text-left w-32">Date</th>
    <th className="px-3 py-2 text-right w-32">Value</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<AssetValueSnapshotResolved>;
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
}

const AssetValueSnapshotPreviewRow = memo(function AssetValueSnapshotPreviewRow({ row, onEdit, onDelete }: RowProps) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
  return (
    <tr className={ROW_BG[row.status]}>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
          {row.status.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2">
        <EnumCell
          value={row.raw.owner_type ?? ''}
          options={OWNER_TYPE_OPTIONS}
          error={err('owner_type')}
          onChange={(v) => onEdit(row.rowId, { owner_type: v })}
        />
      </td>
      <td className="px-3 py-2">
        {row.raw.owner_name || '—'}
        {err('owner_name') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('owner_name')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <DateCell
          value={row.raw.snapshot_date ?? ''}
          error={err('snapshot_date')}
          onChange={(d) => onEdit(row.rowId, { snapshot_date: d })}
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {row.raw.value ? `$${Number(row.raw.value).toLocaleString()}` : '—'}
        {err('value') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('value')!.message}</div>
        )}
      </td>
      <td className="px-2 py-2">
        <button
          aria-label="Remove row"
          className="text-muted-foreground hover:text-destructive text-sm"
          onClick={() => onDelete(row.rowId)}
        >
          ×
        </button>
      </td>
    </tr>
  );
});

export function AssetValueSnapshotPreviewTable({ state }: Props) {
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={6}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <AssetValueSnapshotPreviewRow
          key={row.rowId}
          row={row}
          onEdit={state.edit}
          onDelete={state.delete}
        />
      )}
    />
  );
}

export default AssetValueSnapshotPreviewTable;
