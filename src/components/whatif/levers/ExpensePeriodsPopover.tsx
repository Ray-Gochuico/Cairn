import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { formatCurrency } from '@/lib/format';
import type { ExpensePeriod } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

function emptyRow(): ExpensePeriod {
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, monthlyDelta: 0, durationMonths: 1, label: '' };
}

export default function ExpensePeriodsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const active = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<ExpensePeriod[]>(active?.leverPayload.expensePeriods ?? []);

  useEffect(() => {
    if (open) setDraft(active?.leverPayload.expensePeriods ?? []);
  }, [open, active?.leverPayload]);

  const setRow = (i: number, patch: Partial<ExpensePeriod>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? ({ ...r, ...patch }) : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { expensePeriods: draft });
    onOpenChange(false);
  };

  const handleReset = () => setDraft(active?.leverPayload.expensePeriods ?? []);

  return (
    <LeverPopoverShell open={open} title="Short-term expense periods" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-2">
        {draft.length === 0 && (
          <p className="text-sm text-muted-foreground">No expense periods yet.</p>
        )}
        {draft.map((row, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end border-b py-2">
            <div>
              <Label htmlFor={`epstart-${i}`} className="text-xs">Start (YYYY-MM-DD)</Label>
              <Input id={`epstart-${i}`} value={row.start} onChange={(e) => setRow(i, { start: e.target.value })} aria-label="Start (YYYY-MM-DD)" />
            </div>
            <div>
              <Label htmlFor={`epdelta-${i}`} className="text-xs">Δ monthly</Label>
              <Input id={`epdelta-${i}`} type="number" step={50} value={row.monthlyDelta} onChange={(e) => setRow(i, { monthlyDelta: Number(e.target.value) || 0 })} aria-label="Δ monthly" />
            </div>
            <div>
              <Label htmlFor={`epdur-${i}`} className="text-xs">Duration (months)</Label>
              <Input id={`epdur-${i}`} type="number" min={1} step={1} value={row.durationMonths} onChange={(e) => setRow(i, { durationMonths: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Duration" />
            </div>
            <div>
              <Label htmlFor={`eplabel-${i}`} className="text-xs">Label</Label>
              <Input id={`eplabel-${i}`} value={row.label ?? ''} onChange={(e) => setRow(i, { label: e.target.value || undefined })} />
            </div>
            <div className="text-sm text-muted-foreground sm:col-span-1">
              {formatCurrency(row.monthlyDelta * row.durationMonths)} total
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm"
                aria-label={`Remove row ${i + 1}`}
                onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, emptyRow()])} aria-label="Add period">
            + Add period
          </Button>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
