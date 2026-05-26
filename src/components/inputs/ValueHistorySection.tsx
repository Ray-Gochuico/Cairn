import { useEffect, useMemo, useState } from 'react';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import type { AssetSnapshotOwnerType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export interface ValueHistorySectionProps {
  /** PROPERTY or VEHICLE — the discriminator for the snapshots row. */
  ownerType: AssetSnapshotOwnerType;
  /** id of the property or vehicle. */
  ownerId: number;
  /**
   * Display fallback for the empty state — typically the entity's
   * currentEstimatedValue. Null when not set.
   */
  fallbackValue: number | null;
}

/**
 * Collapsible section that lists user-entered dated value snapshots for
 * one property or vehicle, plus a small add-form and per-row edit / delete
 * controls. Mounted under each asset's display card on the Property and
 * Vehicles pages.
 *
 * One store is shared across every mounted section — components filter
 * by (ownerType, ownerId) in a useMemo here at the consumption site. The
 * section calls load() once on mount.
 */
export default function ValueHistorySection({
  ownerType,
  ownerId,
  fallbackValue,
}: ValueHistorySectionProps) {
  const allSnapshots = useAssetValueSnapshotsStore((s) => s.assetValueSnapshots);
  const load = useAssetValueSnapshotsStore((s) => s.load);
  const createSnapshot = useAssetValueSnapshotsStore((s) => s.create);
  const updateSnapshot = useAssetValueSnapshotsStore((s) => s.update);
  const removeSnapshot = useAssetValueSnapshotsStore((s) => s.remove);

  useEffect(() => {
    load();
  }, [load]);

  const entries = useMemo(
    () =>
      allSnapshots
        .filter((s) => s.ownerType === ownerType && s.ownerId === ownerId)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)),
    [allSnapshots, ownerType, ownerId],
  );

  // Add-form local state
  const [date, setDate] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Edit-row local state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValueStr, setEditValueStr] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!date) {
      setAddError('Pick a date.');
      return;
    }
    const trimmed = valueStr.trim();
    if (trimmed === '') {
      setAddError('Enter a value.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setAddError('Enter a non-negative number.');
      return;
    }
    setAdding(true);
    try {
      await createSnapshot({
        ownerType,
        ownerId,
        snapshotDate: date,
        value: parsed,
      });
      setDate('');
      setValueStr('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add entry.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this dated value entry? This cannot be undone.')) {
      return;
    }
    try {
      await removeSnapshot(id);
    } catch (err) {
      // Re-loading will surface the error in state.error; nothing to do here.
      console.error('Failed to delete value snapshot', err);
    }
  }

  function startEdit(id: number, currentValue: number) {
    setEditingId(id);
    setEditValueStr(String(currentValue));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValueStr('');
    setEditError(null);
  }

  async function saveEdit(id: number) {
    setEditError(null);
    const trimmed = editValueStr.trim();
    if (trimmed === '') {
      setEditError('Enter a value.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditError('Enter a non-negative number.');
      return;
    }
    setSavingEdit(true);
    try {
      await updateSnapshot(id, { value: parsed });
      cancelEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <details className="mt-3 rounded-md border bg-card">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium hover:bg-muted/40">
        Value history ({entries.length})
      </summary>
      <div className="p-4 space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Using current estimated value
            {fallbackValue != null ? ` (${formatCurrency(fallbackValue)})` : ''}{' '}
            as a flat horizontal across the chart. Add dated entries below to
            show value over time.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {entries.map((entry) => {
              const isEditing = entry.id === editingId;
              const rowKey = `value-history-row-${ownerId}-${entry.snapshotDate}`;
              return (
                <li
                  key={entry.id}
                  data-testid={rowKey}
                  className="flex flex-wrap items-center gap-2 border-b py-1 last:border-b-0"
                >
                  <span className="font-mono tabular-nums text-xs text-muted-foreground w-28">
                    {entry.snapshotDate}
                  </span>
                  {isEditing ? (
                    <>
                      <Label
                        htmlFor={`edit-value-${entry.id}`}
                        className="sr-only"
                      >
                        Edit value
                      </Label>
                      <Input
                        id={`edit-value-${entry.id}`}
                        type="number"
                        min={0}
                        step="any"
                        value={editValueStr}
                        onChange={(e) => setEditValueStr(e.target.value)}
                        disabled={savingEdit}
                        className="w-32 h-8"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveEdit(entry.id!)}
                        disabled={savingEdit}
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelEdit}
                        disabled={savingEdit}
                      >
                        Cancel
                      </Button>
                      {editError ? (
                        <span className="text-xs text-red-600 w-full">
                          {editError}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="font-mono tabular-nums flex-1">
                        {formatCurrency(entry.value)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(entry.id!, entry.value)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(entry.id!)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={handleAdd}
          noValidate
          className="flex flex-wrap items-end gap-2 border-t pt-3"
        >
          <div className="flex flex-col gap-1">
            <Label
              htmlFor={`value-history-date-${ownerType}-${ownerId}`}
              className="text-xs"
            >
              Date
            </Label>
            <Input
              id={`value-history-date-${ownerType}-${ownerId}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={adding}
              className="w-40 h-8"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label
              htmlFor={`value-history-value-${ownerType}-${ownerId}`}
              className="text-xs"
            >
              Value
            </Label>
            <Input
              id={`value-history-value-${ownerType}-${ownerId}`}
              type="number"
              min={0}
              step="any"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              disabled={adding}
              className="w-32 h-8"
            />
          </div>
          <Button type="submit" size="sm" disabled={adding}>
            {adding ? 'Adding…' : 'Add entry'}
          </Button>
          {addError ? (
            <span className="text-xs text-red-600 w-full">{addError}</span>
          ) : null}
        </form>
      </div>
    </details>
  );
}
