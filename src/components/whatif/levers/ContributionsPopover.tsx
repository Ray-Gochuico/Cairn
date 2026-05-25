import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import type { ContributionSegment } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

// DraftRow uses 1-based years for the UI; segments are persisted with 0-based
// months-from-projection-start. "Open-ended" is represented as endYear === null.
interface DraftRow {
  startYear: number;
  endYear: number | null;
  monthlyAmount: number;
  label: string;
}

function segmentsToDraft(segments: ContributionSegment[]): DraftRow[] {
  return segments.map((s) => ({
    startYear: Math.floor(s.startMonth / 12) + 1,
    endYear: s.endMonth === null ? null : Math.floor(s.endMonth / 12) + 1,
    monthlyAmount: s.monthlyAmount,
    label: s.label ?? '',
  }));
}

function draftToSegments(rows: DraftRow[]): ContributionSegment[] {
  return rows.map((r) => {
    const startMonth = Math.max(0, (r.startYear - 1) * 12);
    const endMonth = r.endYear === null ? null : Math.max(startMonth, r.endYear * 12 - 1);
    const seg: ContributionSegment = {
      startMonth,
      endMonth,
      monthlyAmount: Math.max(0, r.monthlyAmount),
    };
    if (r.label.trim()) seg.label = r.label.trim();
    return seg;
  });
}

function emptyRow(): DraftRow {
  return { startYear: 1, endYear: 5, monthlyAmount: 1000, label: '' };
}

export default function ContributionsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const active = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<DraftRow[]>(
    segmentsToDraft(active?.leverPayload.contributions ?? []),
  );

  useEffect(() => {
    if (open) setDraft(segmentsToDraft(active?.leverPayload.contributions ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.leverPayload]);

  const setRow = (i: number, patch: Partial<DraftRow>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, {
      contributions: draftToSegments(draft),
    });
    onOpenChange(false);
  };

  const handleReset = () =>
    setDraft(segmentsToDraft(active?.leverPayload.contributions ?? []));

  return (
    <LeverPopoverShell
      open={open}
      title="Investment contributions"
      onOpenChange={onOpenChange}
      onApply={handleApply}
      onReset={handleReset}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Set a fixed monthly contribution that flows into investments over a span
          of years. Any surplus above the contribution accumulates as cash; a
          shortfall lets cash drop (or go negative) while the contribution still
          lands in investments. With no segments configured, all savings route to
          investments as before.
        </p>

        <div className="space-y-2">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">No contribution segments yet.</p>
          )}
          {draft.map((row, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end border-b py-2">
              <div>
                <Label htmlFor={`cstart-${i}`} className="text-xs">From year</Label>
                <Input
                  id={`cstart-${i}`}
                  type="number"
                  min={1}
                  step={1}
                  value={row.startYear}
                  onChange={(e) => setRow(i, { startYear: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                  aria-label="From year"
                />
              </div>
              <div>
                <Label htmlFor={`cend-${i}`} className="text-xs">Through year</Label>
                <Input
                  id={`cend-${i}`}
                  type="number"
                  min={1}
                  step={1}
                  placeholder="open"
                  value={row.endYear ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') setRow(i, { endYear: null });
                    else setRow(i, { endYear: Math.max(row.startYear, Math.floor(Number(raw) || row.startYear)) });
                  }}
                  aria-label="Through year (blank = open-ended)"
                />
              </div>
              <div>
                <Label htmlFor={`camt-${i}`} className="text-xs">Monthly ($)</Label>
                <Input
                  id={`camt-${i}`}
                  type="number"
                  min={0}
                  step={50}
                  value={row.monthlyAmount}
                  onChange={(e) => setRow(i, { monthlyAmount: Math.max(0, Number(e.target.value) || 0) })}
                  aria-label="Monthly amount"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`clabel-${i}`} className="text-xs">Label</Label>
                <Input
                  id={`clabel-${i}`}
                  value={row.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  aria-label="Label"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove segment ${i + 1}`}
                  onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft((d) => [...d, emptyRow()])}
              aria-label="Add segment"
            >
              + Add segment
            </Button>
          </div>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
