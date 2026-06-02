import { memo } from 'react';
import { OwnerPersonCell } from './OwnerPersonCell';
import { BooleanCell } from './BooleanCell';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { VehicleResolved } from '@/lib/import/validators/vehicle';

interface Props {
  state: ImportPreviewState<'vehicle'>;
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

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left">Name</th>
    <th className="px-3 py-2 text-left w-44">Make / Model / Year</th>
    <th className="px-3 py-2 text-right w-28">Est. value</th>
    <th className="px-3 py-2 text-left w-28">Purchase date</th>
    <th className="px-3 py-2 text-left w-32">Owner</th>
    <th className="px-3 py-2 text-center w-20">Excl.</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<VehicleResolved>;
  persons: ReadonlyArray<{ id: number; name: string }>;
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
}

const VehiclePreviewRow = memo(function VehiclePreviewRow({ row, persons, onEdit, onDelete }: RowProps) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
  const r = row.resolved;
  const ymm = [r.year ?? '', r.make ?? '', r.model ?? '']
    .filter((s) => s !== '' && s != null)
    .join(' ');
  return (
    <tr className={ROW_BG[row.status]}>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
          {row.status.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2">
        {row.raw.name || '—'}
        {err('name') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('name')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {ymm || '—'}
        {err('year') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('year')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {r.currentEstimatedValue != null
          ? `$${r.currentEstimatedValue.toLocaleString()}`
          : '—'}
        {err('current_estimated_value') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('current_estimated_value')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {row.raw.purchase_date || '—'}
        {err('purchase_date') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('purchase_date')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <OwnerPersonCell
          value={r.ownerPersonId ?? null}
          persons={persons}
          error={err('owner_person_name')}
          onChange={(personId) => {
            const name =
              personId == null
                ? ''
                : persons.find((p) => p.id === personId)?.name ?? '';
            onEdit(row.rowId, { owner_person_name: name });
          }}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <BooleanCell
          value={r.excludedFromNetWorth}
          error={err('excluded_from_net_worth')}
          onChange={(v) =>
            onEdit(row.rowId, { excluded_from_net_worth: v ? 'true' : 'false' })
          }
        />
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

export function VehiclePreviewTable({ state }: Props) {
  const persons = state.ctx.persons ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={8}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <VehiclePreviewRow
          key={row.rowId}
          row={row}
          persons={persons}
          onEdit={state.edit}
          onDelete={state.delete}
        />
      )}
    />
  );
}

export default VehiclePreviewTable;
