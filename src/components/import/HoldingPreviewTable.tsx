import { AccountCell } from './AccountCell';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewStatus } from '@/lib/import/types';

interface Props {
  state: ImportPreviewState<'holding'>;
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

export function HoldingPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left">Account</th>
            <th className="px-3 py-2 text-left w-28">Ticker</th>
            <th className="px-3 py-2 text-right w-28">Shares</th>
            <th className="px-3 py-2 text-right w-32">Cost/share</th>
            <th className="px-3 py-2 text-right w-24">Target %</th>
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
                  <AccountCell
                    value={row.raw.account_name ?? ''}
                    error={err('account_name')}
                    accounts={state.ctx.accounts}
                    onChange={(name) => state.edit(row.rowId, { account_name: name })}
                  />
                </td>
                <td className="px-3 py-2 font-mono">
                  {row.resolved.ticker || row.raw.ticker || '—'}
                  {err('ticker') && (
                    <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{err('ticker')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {row.raw.share_count || '—'}
                  {err('share_count') && (
                    <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
                      {err('share_count')!.message}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {row.resolved.costBasis != null
                    ? `$${row.resolved.costBasis.toLocaleString()}`
                    : '—'}
                  {err('cost_basis_per_share') && (
                    <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
                      {err('cost_basis_per_share')!.message}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-right text-xs">
                  {row.resolved.targetAllocationPct != null
                    ? `${(row.resolved.targetAllocationPct * 100).toFixed(1)}%`
                    : '—'}
                  {err('target_allocation_pct') && (
                    <div className="text-xs text-destructive-soft-foreground italic mt-0.5">
                      {err('target_allocation_pct')!.message}
                    </div>
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

export default HoldingPreviewTable;
