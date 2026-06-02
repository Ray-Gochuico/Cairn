import { memo } from 'react';
import { EnumCell } from './EnumCell';
import { OwnerPersonCell } from './OwnerPersonCell';
import { VirtualizedPreviewTable, PreviewEmptyState, EMPTY_OPTIONS } from './VirtualizedPreviewTable';
import { AccountType } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewRow, PreviewStatus, RawRow, RowId } from '@/lib/import/types';
import type { AccountResolved } from '@/lib/import/validators/account';

interface Props {
  state: ImportPreviewState<'account'>;
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

// Static enum list — hoisted so its identity is stable across renders, keeping
// the per-row React.memo meaningful (a fresh Object.values(...) each render
// would change the `options` prop reference and force every row to re-render).
const ACCOUNT_TYPE_OPTIONS = Object.values(AccountType);

const HEAD = (
  <>
    <th className="px-3 py-2 text-left w-20">Status</th>
    <th className="px-3 py-2 text-left">Name</th>
    <th className="px-3 py-2 text-left w-44">Type</th>
    <th className="px-3 py-2 text-right w-32">Current bal.</th>
    <th className="px-3 py-2 text-left w-40">Owner</th>
    <th className="px-3 py-2 text-left w-24">Color</th>
    <th className="px-3 py-2 text-right w-20">APY</th>
    <th className="px-2 py-2 w-8" />
  </>
);

interface RowProps {
  row: PreviewRow<AccountResolved>;
  persons: ReadonlyArray<{ id: number; name: string }>;
  onEdit: (rowId: RowId, patch: RawRow) => void;
  onDelete: (rowId: RowId) => void;
}

const AccountPreviewRow = memo(function AccountPreviewRow({ row, persons, onEdit, onDelete }: RowProps) {
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
          options={ACCOUNT_TYPE_OPTIONS}
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
      <td className="px-3 py-2">
        <OwnerPersonCell
          value={row.resolved.ownerPersonId ?? null}
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
      <td className="px-3 py-2 text-xs">
        {row.resolved.accentColor ?? row.raw.accent_color ?? '—'}
        {err('accent_color') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('accent_color')!.message}
          </div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right text-xs">
        {row.resolved.apyRate != null
          ? `${(row.resolved.apyRate * 100).toFixed(2)}%`
          : '—'}
        {err('apy_rate') && (
          <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
            {err('apy_rate')!.message}
          </div>
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

export function AccountPreviewTable({ state }: Props) {
  const persons = state.ctx.persons ?? EMPTY_OPTIONS;
  return (
    <VirtualizedPreviewTable
      rows={state.derivedRows}
      columnCount={8}
      head={HEAD}
      empty={<PreviewEmptyState />}
      renderRow={(row) => (
        <AccountPreviewRow
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

export default AccountPreviewTable;
