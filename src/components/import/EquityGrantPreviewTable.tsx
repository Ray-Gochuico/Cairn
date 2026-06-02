import { memo } from 'react';
import { OwnerPersonCell } from './OwnerPersonCell';
import { DateCell } from './DateCell';
import { VestingScheduleCell } from './VestingScheduleCell';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { EquityGrantResolved } from '@/lib/import/validators/equity-grant';

interface Props {
  state: ImportPreviewState<'equity_grant'>;
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
    <th className="px-3 py-2 text-left">Name / Company</th>
    <th className="px-3 py-2 text-left w-32">Owner</th>
    <th className="px-3 py-2 text-left w-28">Grant date</th>
    <th className="px-3 py-2 text-right w-24">Strike</th>
    <th className="px-3 py-2 text-right w-24">Total shares</th>
    <th className="px-3 py-2 text-right w-20">FMV</th>
    <th className="px-3 py-2 text-left">Vesting</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<EquityGrantResolved>;
  persons: ReadonlyArray<{ id: number; name: string }>;
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
}

const EquityGrantPreviewRow = memo(function EquityGrantPreviewRow({ row, persons, onEdit, onDelete }: RowProps) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
  const r = row.resolved;
  return (
    <tr className={ROW_BG[row.status]}>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
          {row.status.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2">
        <div>{row.raw.name || '—'}</div>
        <div className="text-xs text-muted-foreground">{row.raw.company_name || '—'}</div>
        {err('name') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('name')!.message}</div>
        )}
        {err('company_name') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('company_name')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <OwnerPersonCell
          value={r.ownerPersonId || null}
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
      <td className="px-3 py-2">
        <DateCell
          value={row.raw.grant_date ?? ''}
          error={err('grant_date')}
          onChange={(d) => onEdit(row.rowId, { grant_date: d })}
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        ${(r.strikePrice ?? 0).toLocaleString()}
        {err('strike_price') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('strike_price')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {(r.totalShares ?? 0).toLocaleString()}
        {err('total_shares') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('total_shares')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        ${(r.currentFmv ?? 0).toLocaleString()}
        {err('current_fmv') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('current_fmv')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <VestingScheduleCell
          value={row.raw.vesting_schedule_json ?? ''}
          error={err('vesting_schedule_json')}
          onChange={(v) => onEdit(row.rowId, { vesting_schedule_json: v })}
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

export function EquityGrantPreviewTable({ state }: Props) {
  const persons = state.ctx.persons ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={9}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <EquityGrantPreviewRow
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

export default EquityGrantPreviewTable;
