import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import type { LumpSumEvent } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

function emptyRow(): LumpSumEvent {
  const today = new Date().toISOString().slice(0, 10);
  return { when: today, amount: 0, destination: 'investments', label: '' };
}

export default function LumpSumsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const active = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<LumpSumEvent[]>(active?.leverPayload.lumpSums ?? []);

  useEffect(() => {
    if (open) setDraft(active?.leverPayload.lumpSums ?? []);
  }, [open, active?.leverPayload]);

  const setRow = (i: number, patch: Partial<LumpSumEvent>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? ({ ...r, ...patch } as LumpSumEvent) : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { lumpSums: draft });
    onOpenChange(false);
  };

  const handleReset = () => setDraft(active?.leverPayload.lumpSums ?? []);

  return (
    <LeverPopoverShell open={open} title="Lump-sum events" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-2">
        {draft.length === 0 && (
          <p className="text-sm text-muted-foreground">No lump-sum events yet.</p>
        )}
        {draft.map((row, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end border-b py-2">
            <div>
              <Label htmlFor={`when-${i}`} className="text-xs">When (YYYY-MM-DD)</Label>
              <Input id={`when-${i}`} value={row.when} onChange={(e) => setRow(i, { when: e.target.value })} aria-label="When" />
            </div>
            <div>
              <Label htmlFor={`amount-${i}`} className="text-xs">Amount</Label>
              <Input id={`amount-${i}`} type="number" step={100} value={row.amount} onChange={(e) => setRow(i, { amount: Number(e.target.value) || 0 })} aria-label="Amount" />
            </div>
            <div>
              <Label htmlFor={`dest-${i}`} className="text-xs">Destination</Label>
              <select
                id={`dest-${i}`}
                className="border rounded h-9 px-2 w-full text-sm bg-background"
                value={row.destination}
                onChange={(e) => setRow(i, { destination: e.target.value as 'cash' | 'investments' })}
                aria-label="Destination"
              >
                <option value="investments">Investments</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div>
              <Label htmlFor={`label-${i}`} className="text-xs">Label</Label>
              <Input id={`label-${i}`} value={row.label ?? ''} onChange={(e) => setRow(i, { label: e.target.value || undefined })} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
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
          <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, emptyRow()])} aria-label="Add event">
            + Add event
          </Button>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
