import { memo } from 'react';
import { AccountCell } from './AccountCell';
import { DateCell } from './DateCell';
import { EnumCell } from './EnumCell';
import { OwnerPersonCell } from './OwnerPersonCell';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import { ContributionSource } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { ContributionResolved } from '@/lib/import/validators/contribution';

interface Props {
  state: ImportPreviewState<'contribution'>;
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

const SOURCE_OPTIONS = Object.values(ContributionSource);

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left">Account</th>
    <th className="px-3 py-2 text-left w-32">Date</th>
    <th className="px-3 py-2 text-right w-28">Amount</th>
    <th className="px-3 py-2 text-left w-40">Source</th>
    <th className="px-3 py-2 text-left w-32">Person</th>
    <th className="px-3 py-2 text-left w-24">Action</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<ContributionResolved>;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  persons: ReadonlyArray<{ id: number; name: string }>;
  conflictMode: 'update' | 'skip';
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
  onConflictChange: (rowId: RowId, mode: 'update' | 'skip') => void;
}

const ContributionPreviewRow = memo(function ContributionPreviewRow({
  row,
  accounts,
  persons,
  conflictMode,
  onEdit,
  onDelete,
  onConflictChange,
}: RowProps) {
  const err = (field: string) => row.errors.find((e) => e.field === field);
  const showsConflict = row.status === 'duplicate';
  return (
    <tr className={ROW_BG[row.status]}>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
          {row.status.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-2">
        <AccountCell
          value={row.raw.account_name ?? ''}
          error={err('account_name')}
          accounts={accounts}
          onChange={(name) => onEdit(row.rowId, { account_name: name })}
        />
      </td>
      <td className="px-3 py-2">
        <DateCell
          value={row.raw.contribution_date ?? ''}
          error={err('contribution_date')}
          onChange={(d) => onEdit(row.rowId, { contribution_date: d })}
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-right">
        {row.raw.amount ? `$${Number(row.raw.amount).toLocaleString()}` : '—'}
        {err('amount') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('amount')!.message}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <EnumCell
          value={row.raw.source ?? ContributionSource.MANUAL}
          options={SOURCE_OPTIONS}
          error={err('source')}
          onChange={(v) => onEdit(row.rowId, { source: v })}
        />
      </td>
      <td className="px-3 py-2">
        <OwnerPersonCell
          value={row.resolved.personId ?? null}
          persons={persons}
          error={err('person_name')}
          onChange={(personId) => {
            const name =
              personId == null
                ? ''
                : persons.find((p) => p.id === personId)?.name ?? '';
            onEdit(row.rowId, { person_name: name });
          }}
        />
      </td>
      <td className="px-3 py-2">
        {showsConflict ? (
          <select
            value={conflictMode}
            onChange={(e) =>
              onConflictChange(row.rowId, e.target.value as 'update' | 'skip')
            }
            className="text-xs px-1.5 py-0.5 border border-input rounded w-full bg-transparent"
          >
            <option value="skip">Skip</option>
            <option value="update">Insert</option>
          </select>
        ) : '—'}
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

export function ContributionPreviewTable({ state }: Props) {
  const persons = state.ctx.persons ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={8}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <ContributionPreviewRow
          key={row.rowId}
          row={row}
          accounts={state.ctx.accounts}
          persons={persons}
          conflictMode={state.conflictMode.get(row.rowId) ?? 'skip'}
          onEdit={state.edit}
          onDelete={state.delete}
          onConflictChange={state.setConflictMode}
        />
      )}
    />
  );
}

export default ContributionPreviewTable;
