import { DateCell } from './DateCell';
import { AccountCell } from './AccountCell';
import { ValueCell } from './ValueCell';
import { MerchantCell } from './MerchantCell';
import { CategoryCell } from './CategoryCell';
import { ReimbursableCell } from './ReimbursableCell';
import type { PreviewRow, PreviewStatus, RowId, RawRow } from '@/lib/import/types';
import type { TransactionResolved } from '@/lib/import/validators/transaction-validator';

interface Props {
  row: PreviewRow<TransactionResolved>;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  categories: ReadonlyArray<{ id: number; name: string }>;
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

export function TransactionPreviewRow({
  row,
  accounts,
  categories,
  conflictMode,
  onEdit,
  onDelete,
  onConflictChange,
}: Props) {
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
        <DateCell
          value={row.raw.date ?? ''}
          error={err('date')}
          onChange={(d) => onEdit(row.rowId, { date: d })}
        />
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
        <ValueCell
          value={row.raw.amount ?? ''}
          error={err('amount')}
          onChange={(v) => onEdit(row.rowId, { amount: v })}
        />
      </td>
      <td className="px-3 py-2">
        <MerchantCell
          value={row.raw.merchant ?? ''}
          error={err('merchant')}
          onChange={(v) => onEdit(row.rowId, { merchant: v })}
        />
      </td>
      <td className="px-3 py-2">
        <CategoryCell
          value={row.raw.category ?? ''}
          error={err('category')}
          categories={categories}
          onChange={(v) => onEdit(row.rowId, { category: v })}
        />
      </td>
      <td className="px-3 py-2">
        <ReimbursableCell
          value={row.raw.reimbursable ?? ''}
          error={err('reimbursable')}
          onChange={(v) => onEdit(row.rowId, { reimbursable: v })}
        />
      </td>
      <td className="px-3 py-2">
        {showsConflict ? (
          <select
            value={conflictMode}
            onChange={(e) => onConflictChange(row.rowId, e.target.value as 'update' | 'skip')}
            className="text-xs px-1.5 py-0.5 border border-slate-300 rounded w-full"
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
        >×</button>
      </td>
    </tr>
  );
}
