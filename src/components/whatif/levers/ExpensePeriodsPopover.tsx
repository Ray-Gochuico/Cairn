import { useEffect, useMemo, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { monthlyExpenseFromPeriods } from '@/lib/scenarios/apply-real';
import { formatCurrency } from '@/lib/format';
import type { ExpensePeriod } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

function emptyRow(): ExpensePeriod {
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, monthlyDelta: 0, durationMonths: 1, label: '' };
}

function todayMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExpensePeriodsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const active = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<ExpensePeriod[]>(active?.leverPayload.expensePeriods ?? []);

  useEffect(() => {
    if (open) {
      setDraft(active?.leverPayload.expensePeriods ?? []);
    }
  }, [open, active?.leverPayload]);

  // Live summary of the scenario's monthly expenses for the current calendar
  // month — computed against the in-flight draft so the user sees the impact
  // of their edits before clicking Apply. Mirrors the engine's
  // `monthlyExpenseFromPeriods` helper exactly.
  const monthISO = useMemo(todayMonthISO, []);
  const monthlyTotal = useMemo(
    () => monthlyExpenseFromPeriods(draft, monthISO),
    [draft, monthISO],
  );
  const annualTotal = monthlyTotal * 12;

  const setRow = (i: number, patch: Partial<ExpensePeriod>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? ({ ...r, ...patch }) : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { expensePeriods: draft });
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(active?.leverPayload.expensePeriods ?? []);
  };

  return (
    <LeverPopoverShell open={open} title="Expenses" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-3">
        {/* Summary box (revamp 2026-05-26): mirrors the engine's current-month
            expense total. Updates live as the user edits the period list
            below — no Apply click needed to refresh the math. */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            This scenario&apos;s monthly expenses (current month)
          </div>
          <div className="flex items-baseline gap-3">
            <span data-testid="expense-summary-monthly" className="font-mono tabular-nums text-base">
              {formatCurrency(monthlyTotal)}/mo
            </span>
            <span className="text-xs text-muted-foreground">
              Annual: <span data-testid="expense-summary-annual" className="font-mono tabular-nums">{formatCurrency(annualTotal)}</span>
            </span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Monthly expense amount during this window. Add multiple periods to
          model expenses changing over time. Use a negative amount to overlay
          a reduction on top of an overlapping period.
        </div>

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
                <Label htmlFor={`epdelta-${i}`} className="text-xs">Monthly expense</Label>
                <Input id={`epdelta-${i}`} type="number" step={50} value={row.monthlyDelta} onChange={(e) => setRow(i, { monthlyDelta: Number(e.target.value) || 0 })} aria-label="Monthly expense" />
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
      </div>
    </LeverPopoverShell>
  );
}
