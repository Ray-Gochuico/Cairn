import { AccountCell } from './AccountCell';
import { DateCell } from './DateCell';
import { EnumCell } from './EnumCell';
import { OwnerPersonCell } from './OwnerPersonCell';
import { ContributionSource } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewStatus } from '@/lib/import/types';

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

export function ContributionPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  const persons = state.ctx.persons ?? [];
  const sourceOptions = Object.values(ContributionSource);
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left">Account</th>
            <th className="px-3 py-2 text-left w-32">Date</th>
            <th className="px-3 py-2 text-right w-28">Amount</th>
            <th className="px-3 py-2 text-left w-40">Source</th>
            <th className="px-3 py-2 text-left w-32">Person</th>
            <th className="px-3 py-2 text-left w-24">Action</th>
            <th className="px-2 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {state.derivedRows.map((row) => {
            const err = (field: string) => row.errors.find((e) => e.field === field);
            const showsConflict = row.status === 'duplicate';
            return (
              <tr key={row.rowId} className={ROW_BG[row.status]}>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
                    {row.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <AccountCell
                    value={row.raw.account_name ?? ''}
                    error={err('account_name')}
                    accounts={state.ctx.accounts}
                    onChange={(name) => state.edit(row.rowId, { account_name: name })}
                  />
                </td>
                <td className="px-3 py-2">
                  <DateCell
                    value={row.raw.contribution_date ?? ''}
                    error={err('contribution_date')}
                    onChange={(d) => state.edit(row.rowId, { contribution_date: d })}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {row.raw.amount ? `$${Number(row.raw.amount).toLocaleString()}` : '—'}
                  {err('amount') && (
                    <div className="text-xs text-destructive italic mt-0.5">{err('amount')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <EnumCell
                    value={row.raw.source ?? ContributionSource.MANUAL}
                    options={sourceOptions}
                    error={err('source')}
                    onChange={(v) => state.edit(row.rowId, { source: v })}
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
                      state.edit(row.rowId, { person_name: name });
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  {showsConflict ? (
                    <select
                      value={state.conflictMode.get(row.rowId) ?? 'skip'}
                      onChange={(e) =>
                        state.setConflictMode(row.rowId, e.target.value as 'update' | 'skip')
                      }
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

export default ContributionPreviewTable;
