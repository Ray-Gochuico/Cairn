import { memo } from 'react';
import { EnumCell } from './EnumCell';
import { OwnerPersonCell } from './OwnerPersonCell';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import { LoanType } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { LoanResolved } from '@/lib/import/validators/loan';

interface Props {
  state: ImportPreviewState<'loan'>;
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

const LOAN_TYPE_OPTIONS = Object.values(LoanType);

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left">Name</th>
    <th className="px-3 py-2 text-left w-32">Type</th>
    <th className="px-3 py-2 text-right w-28">Current bal.</th>
    <th className="px-3 py-2 text-right w-20">Rate</th>
    <th className="px-3 py-2 text-right w-16">Term</th>
    <th className="px-3 py-2 text-left w-28">First pmt</th>
    <th className="px-3 py-2 text-left w-32">Obligor</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<LoanResolved>;
  persons: ReadonlyArray<{ id: number; name: string }>;
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
}

const LoanPreviewRow = memo(function LoanPreviewRow({ row, persons, onEdit, onDelete }: RowProps) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
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
      <td className="px-3 py-2">
        <EnumCell
          value={row.raw.type ?? ''}
          options={LOAN_TYPE_OPTIONS}
          error={err('type')}
          onChange={(v) => onEdit(row.rowId, { type: v })}
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {row.raw.current_balance
          ? `$${Number(row.raw.current_balance).toLocaleString()}`
          : '—'}
        {err('current_balance') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('current_balance')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {row.raw.interest_rate
          ? `${(Number(row.raw.interest_rate) * 100).toFixed(2)}%`
          : '—'}
        {err('interest_rate') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('interest_rate')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right text-xs">
        {row.raw.term_months || '—'}
        {err('term_months') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('term_months')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {row.raw.first_payment_date || '—'}
        {err('first_payment_date') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('first_payment_date')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <OwnerPersonCell
          value={row.resolved.obligorPersonId ?? null}
          persons={persons}
          error={err('obligor_person_name')}
          onChange={(personId) => {
            const name =
              personId == null
                ? ''
                : persons.find((p) => p.id === personId)?.name ?? '';
            onEdit(row.rowId, { obligor_person_name: name });
          }}
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

export function LoanPreviewTable({ state }: Props) {
  const persons = state.ctx.persons ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={9}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <LoanPreviewRow
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

export default LoanPreviewTable;
