import { useEffect, useMemo, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { computeBaselineExpenses, recentMonthlyExpenseTotals } from '@/lib/expense-baseline';
import { formatCurrency } from '@/lib/format';
import type { ExpensePeriod } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

function emptyRow(): ExpensePeriod {
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, monthlyDelta: 0, durationMonths: 1, label: '' };
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortMonth(monthISO: string): string {
  const [, m] = monthISO.split('-').map(Number);
  return m ? MONTH_NAMES[m - 1] : monthISO;
}

function todayDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensePeriodsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const household = useHouseholdStore((s) => s.household);
  const updateHousehold = useHouseholdStore((s) => s.update);
  const transactions = useTransactionsStore((s) => s.transactions);
  const active = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<ExpensePeriod[]>(active?.leverPayload.expensePeriods ?? []);
  const initialBaseline = (household as unknown as { monthlyExpenseBaseline?: number })?.monthlyExpenseBaseline ?? 0;
  const [baselineDraft, setBaselineDraft] = useState<number>(initialBaseline);

  useEffect(() => {
    if (open) {
      setDraft(active?.leverPayload.expensePeriods ?? []);
      setBaselineDraft(initialBaseline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.leverPayload, initialBaseline]);

  const startISO = todayDateISO();
  const recentMonths = useMemo(
    () => recentMonthlyExpenseTotals(transactions, startISO, 6),
    [transactions, startISO],
  );
  const rollingAvg = useMemo(
    () => computeBaselineExpenses(transactions, startISO),
    [transactions, startISO],
  );

  const setRow = (i: number, patch: Partial<ExpensePeriod>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? ({ ...r, ...patch }) : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { expensePeriods: draft });
    if (baselineDraft !== initialBaseline) {
      await updateHousehold({ monthlyExpenseBaseline: baselineDraft } as any);
    }
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(active?.leverPayload.expensePeriods ?? []);
    setBaselineDraft(initialBaseline);
  };

  return (
    <LeverPopoverShell open={open} title="Expenses" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-3">
        <div className="space-y-2" data-testid="expense-baseline-suggestions">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="baseline-custom" className="text-xs">Monthly expense baseline ($)</Label>
              <Input
                id="baseline-custom"
                type="number"
                min={0}
                step={50}
                value={baselineDraft}
                onChange={(e) => setBaselineDraft(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Custom monthly baseline"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {recentMonths.map((m) => (
              <Button
                key={m.monthISO}
                size="sm"
                variant={baselineDraft === Math.round(m.total) ? 'default' : 'outline'}
                onClick={() => setBaselineDraft(Math.round(m.total))}
                aria-label={`Set baseline to ${shortMonth(m.monthISO)} total ${formatCurrency(m.total)}`}
              >
                {shortMonth(m.monthISO)}: {formatCurrency(m.total)}
              </Button>
            ))}
            {rollingAvg > 0 && (
              <Button
                size="sm"
                variant={Math.round(baselineDraft) === Math.round(rollingAvg) ? 'default' : 'outline'}
                onClick={() => setBaselineDraft(Math.round(rollingAvg))}
                aria-label={`Set baseline to 12mo rolling average ${formatCurrency(rollingAvg)}`}
              >
                12mo avg: {formatCurrency(rollingAvg)}
              </Button>
            )}
            {recentMonths.length === 0 && rollingAvg === 0 && (
              <span className="text-muted-foreground">No transactions yet — type a baseline above.</span>
            )}
          </div>
        </div>

        <div className="pt-2 border-t" />

        <div className="text-xs font-medium text-muted-foreground">Short-term expense periods</div>
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
      </div>
    </LeverPopoverShell>
  );
}
