import { EnumCell } from './EnumCell';
import { OwnerPersonCell } from './OwnerPersonCell';
import { BooleanCell } from './BooleanCell';
import { PropertyType } from '@/types/enums';
import type { ImportPreviewState } from '@/stores/import-preview-store';
import type { PreviewStatus } from '@/lib/import/types';

interface Props {
  state: ImportPreviewState<'property'>;
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

export function PropertyPreviewTable({ state }: Props) {
  if (state.derivedRows.length === 0) {
    return (
      <div className="border rounded p-6 text-center text-sm text-slate-500">
        No rows to preview — they were all removed.
      </div>
    );
  }
  const persons = state.ctx.persons ?? [];
  const propertyTypeOptions = Object.values(PropertyType);
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left w-20">Status</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left w-40">Type</th>
            <th className="px-3 py-2 text-right w-32">Est. value</th>
            <th className="px-3 py-2 text-left w-28">Purchase date</th>
            <th className="px-3 py-2 text-left w-32">Owner</th>
            <th className="px-3 py-2 text-center w-20">Excl.</th>
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
                  {row.raw.name || '—'}
                  {err('name') && (
                    <div className="text-xs text-destructive italic mt-0.5">{err('name')!.message}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <EnumCell
                    value={row.raw.type ?? ''}
                    options={propertyTypeOptions}
                    error={err('type')}
                    onChange={(v) => state.edit(row.rowId, { type: v })}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {row.resolved.currentEstimatedValue != null
                    ? `$${row.resolved.currentEstimatedValue.toLocaleString()}`
                    : '—'}
                  {err('current_estimated_value') && (
                    <div className="text-xs text-destructive italic mt-0.5">
                      {err('current_estimated_value')!.message}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.raw.purchase_date || '—'}
                  {err('purchase_date') && (
                    <div className="text-xs text-destructive italic mt-0.5">
                      {err('purchase_date')!.message}
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
                      state.edit(row.rowId, { owner_person_name: name });
                    }}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <BooleanCell
                    value={row.resolved.excludedFromNetWorth}
                    error={err('excluded_from_net_worth')}
                    onChange={(v) =>
                      state.edit(row.rowId, { excluded_from_net_worth: v ? 'true' : 'false' })
                    }
                  />
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

export default PropertyPreviewTable;
