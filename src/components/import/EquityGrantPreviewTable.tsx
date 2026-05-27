import { OwnerPersonCell } from './OwnerPersonCell';
import { DateCell } from './DateCell';
import { VestingScheduleCell } from './VestingScheduleCell';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewStatus } from '@/lib/import/types';

interface Props {
  state: ImportPreviewState<'equity_grant'>;
}

const STATUS_BADGE: Record<PreviewStatus, string> = {
  new: 'bg-emerald-100 text-emerald-800',
  update: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-slate-200 text-slate-700',
  error: 'bg-red-100 text-red-800',
};

const ROW_BG: Record<PreviewStatus, string> = {
  new: '',
  update: 'bg-amber-50',
  duplicate: 'bg-slate-50',
  error: 'bg-red-50',
};

export function EquityGrantPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  const persons = state.ctx.persons ?? [];
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left">Name / Company</th>
            <th className="px-3 py-2 text-left w-32">Owner</th>
            <th className="px-3 py-2 text-left w-28">Grant date</th>
            <th className="px-3 py-2 text-right w-24">Strike</th>
            <th className="px-3 py-2 text-right w-24">Total shares</th>
            <th className="px-3 py-2 text-right w-20">FMV</th>
            <th className="px-3 py-2 text-left">Vesting</th>
            <th className="px-2 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {state.derivedRows.map((row) => {
            const err = (field: string) => row.errors.find((e) => e.field === field);
            const r = row.resolved;
            return (
              <tr key={row.rowId} className={ROW_BG[row.status]}>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded font-semibold ${STATUS_BADGE[row.status]}`}>
                    {row.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div>{row.raw.name || '—'}</div>
                  <div className="text-xs text-slate-500">{row.raw.company_name || '—'}</div>
                  {err('name') && (
                    <div className="text-xs text-red-700 italic mt-0.5">{err('name')!.message}</div>
                  )}
                  {err('company_name') && (
                    <div className="text-xs text-red-700 italic mt-0.5">{err('company_name')!.message}</div>
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
                      state.edit(row.rowId, { owner_person_name: name });
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <DateCell
                    value={row.raw.grant_date ?? ''}
                    error={err('grant_date')}
                    onChange={(d) => state.edit(row.rowId, { grant_date: d })}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  ${(r.strikePrice ?? 0).toLocaleString()}
                  {err('strike_price') && (
                    <div className="text-xs text-red-700 italic mt-0.5">{err('strike_price')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {(r.totalShares ?? 0).toLocaleString()}
                  {err('total_shares') && (
                    <div className="text-xs text-red-700 italic mt-0.5">{err('total_shares')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  ${(r.currentFmv ?? 0).toLocaleString()}
                  {err('current_fmv') && (
                    <div className="text-xs text-red-700 italic mt-0.5">{err('current_fmv')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <VestingScheduleCell
                    value={row.raw.vesting_schedule_json ?? ''}
                    error={err('vesting_schedule_json')}
                    onChange={(v) => state.edit(row.rowId, { vesting_schedule_json: v })}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    aria-label="Remove row"
                    className="text-slate-400 hover:text-red-600 text-sm"
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

export default EquityGrantPreviewTable;
