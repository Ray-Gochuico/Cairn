import { EnumCell } from './EnumCell';
import { DateCell } from './DateCell';
import { AssetSnapshotOwnerType } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewStatus } from '@/lib/import/types';

interface Props {
  state: ImportPreviewState<'asset_value_snapshot'>;
}

const STATUS_BADGE: Record<PreviewStatus, string> = {
  new: 'bg-success-soft text-success-foreground',
  update: 'bg-warning-soft text-warning-foreground',
  duplicate: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/15 text-destructive',
};

const ROW_BG: Record<PreviewStatus, string> = {
  new: '',
  update: 'bg-warning-soft',
  duplicate: 'bg-muted',
  error: 'bg-destructive/10',
};

export function AssetValueSnapshotPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  const ownerTypeOptions = Object.values(AssetSnapshotOwnerType);
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left w-32">Owner type</th>
            <th className="px-3 py-2 text-left">Owner name</th>
            <th className="px-3 py-2 text-left w-32">Date</th>
            <th className="px-3 py-2 text-right w-32">Value</th>
            <th className="px-2 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {state.derivedRows.map((row) => {
            const err = (field: string) => row.errors.find((e) => e.field === field);
            return (
              <tr key={row.rowId} className={ROW_BG[row.status]}>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
                    {row.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <EnumCell
                    value={row.raw.owner_type ?? ''}
                    options={ownerTypeOptions}
                    error={err('owner_type')}
                    onChange={(v) => state.edit(row.rowId, { owner_type: v })}
                  />
                </td>
                <td className="px-3 py-2">
                  {row.raw.owner_name || '—'}
                  {err('owner_name') && (
                    <div className="text-xs text-destructive italic mt-0.5">
                      {err('owner_name')!.message}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <DateCell
                    value={row.raw.snapshot_date ?? ''}
                    error={err('snapshot_date')}
                    onChange={(d) => state.edit(row.rowId, { snapshot_date: d })}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {row.raw.value ? `$${Number(row.raw.value).toLocaleString()}` : '—'}
                  {err('value') && (
                    <div className="text-xs text-destructive italic mt-0.5">{err('value')!.message}</div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <button
                    aria-label="Remove row"
                    className="text-muted-foreground hover:text-destructive text-sm"
                    onClick={() => state.delete(row.rowId)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default AssetValueSnapshotPreviewTable;
