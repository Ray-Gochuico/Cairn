import { useEffect, useMemo, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberField } from '@/components/calculators/NumberField';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useRealState } from '@/components/whatif/useRealState';
import { monthlyExpenseFromPeriods } from '@/lib/scenarios/apply-real';
import { formatCurrency } from '@/lib/format';
import type { ExpensePeriod, LeverPayload } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

type ExpenseSource = LeverPayload['expenseSource'];

// Pin ONE noun for the custom mode — "Custom monthly expense" — used verbatim
// for the tab aria-label, the NumberField label, and the inline base-source
// label. (UX F-4/F-5: no "Custom" / "custom amount" / "Custom monthly expense"
// drift.) The other two labels are the inline base-source phrasings.
const SOURCE_LABEL: Record<ExpenseSource, string> = {
  latestMonth: 'latest complete month',
  rolling12m:  '12-month average',
  custom:      'custom monthly expense',
};

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
  const household = useHouseholdStore((s) => s.household);
  const real = useRealState(); // NEW dependency (spec §B4) — for expenseBasis

  const [draft, setDraft] = useState<ExpensePeriod[]>(active?.leverPayload.expensePeriods ?? []);
  const [source, setSource] = useState<ExpenseSource>(active?.leverPayload.expenseSource ?? 'custom');
  // Held as number|null so NumberField stays blankable (clearing the field mid-edit
  // must NOT snap to 0 — the Wave 0b kit idiom). Coerce `?? 0` only at read/apply.
  const [customMonthly, setCustomMonthly] = useState<number | null>(active?.leverPayload.customMonthly ?? 0);

  useEffect(() => {
    if (open) {
      setDraft(active?.leverPayload.expensePeriods ?? []);
      setSource(active?.leverPayload.expenseSource ?? 'custom');
      setCustomMonthly(active?.leverPayload.customMonthly ?? 0);
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
  // Resolve the data-driven base from expenseBasis (precomputed on RealState at
  // capture). Falls back to 0 when RealState is not yet available.
  const dataBase =
    source === 'latestMonth'
      ? (real?.expenseBasis.latestMonth ?? 0)
      : source === 'rolling12m'
        ? (real?.expenseBasis.rolling12m ?? 0)
        : 0;

  // For custom mode, `customMonthly` drives the base; null (blank field) reads as 0.
  const base = source === 'custom' ? (customMonthly ?? 0) : dataBase;

  // Hard-gated empty-data: a DATA mode that resolves to 0 is a non-silent state.
  const emptyData = source !== 'custom' && dataBase <= 0;
  const householdBaseline = household?.monthlyExpenseBaseline ?? 0;

  // base + active period overlays = effective monthly. The periods represent
  // additive time-bounded adjustments ON TOP of the base.
  const effectiveMonthly = base + monthlyTotal;

  const prefillFromBaseline = () => {
    setSource('custom');
    setCustomMonthly(householdBaseline);
  };

  const setRow = (i: number, patch: Partial<ExpensePeriod>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? ({ ...r, ...patch }) : r)));

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, {
      expensePeriods: draft,
      expenseSource: source,
      customMonthly: Math.max(0, customMonthly ?? 0), // blank → 0 at apply
    });
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(active?.leverPayload.expensePeriods ?? []);
    setSource(active?.leverPayload.expenseSource ?? 'custom');
    setCustomMonthly(active?.leverPayload.customMonthly ?? 0);
  };

  return (
    <LeverPopoverShell open={open} title="Expenses" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-3">
        {/* Expense-source selector (Feature B). Mirrors IncomePopover's tablist idiom. */}
        <div role="tablist" aria-label="Expense source" className="flex gap-1 border-b">
          {(['latestMonth', 'rolling12m', 'custom'] as const).map((s) => (
            <Button
              key={s}
              role="tab"
              aria-selected={source === s}
              size="sm"
              variant={source === s ? 'default' : 'ghost'}
              onClick={() => setSource(s)}
            >
              {s === 'latestMonth' ? 'Latest complete month' : s === 'rolling12m' ? '12-month average' : 'Custom monthly expense'}
            </Button>
          ))}
        </div>

        {source === 'custom' && (
          <NumberField
            id="custom-monthly-expense"
            label="Custom monthly base"
            value={customMonthly}
            onChange={setCustomMonthly}
            suffix="$/mo"
            step="50"
            min={0}
          />
        )}

        {emptyData ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" data-testid="expense-empty-data">
            <div className="font-medium">No spending data in this window</div>
            {/* Copy (UX F-5): the "or:" connector is shown ONLY when the baseline
                prefill button below actually exists (householdBaseline > 0). With
                no baseline there is no dangling "or:" — the Custom-tab fallback is
                offered as a plain sentence instead, so the empty state always ends
                on a real action. Noun is pinned to "Custom" (UX F-4). */}
            {householdBaseline > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mt-1">
                  This mode needs imported transactions. Switch to Custom and enter an
                  amount, or:
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={prefillFromBaseline}>
                  Use my {formatCurrency(householdBaseline)} expense baseline
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                This mode needs imported transactions.{' '}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 align-baseline"
                  onClick={() => setSource('custom')}
                >
                  Switch to Custom
                </Button>{' '}
                to enter an amount.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              This scenario&apos;s monthly expenses (current month)
            </div>
            {/* base + adjustments = effective — so a user who typed ONE number
                isn't surprised by a larger effective figure. The old
                expense-summary-monthly / expense-summary-annual testids are
                preserved so pre-existing tests keep passing. */}
            <div className="grid grid-cols-2 gap-x-3 text-xs tabular-nums mt-1">
              <span>
                Base{' '}
                <span data-testid="expense-base-source" className="text-muted-foreground">
                  ({SOURCE_LABEL[source]})
                </span>
                :
              </span>
              <span data-testid="expense-base" className="font-mono">{formatCurrency(base)}</span>
              <span>+ Adjustments (periods):</span>
              <span data-testid="expense-adjustments" className="font-mono">{formatCurrency(monthlyTotal)}</span>
              <span className="font-medium border-t pt-1">= Effective monthly:</span>
              <span data-testid="expense-effective" className="font-mono font-medium border-t pt-1">{formatCurrency(effectiveMonthly)}</span>
            </div>
            {/* Keep legacy testids so the pre-existing "monthly + annual summary"
                tests still pass. The old display was periods-only; now it also
                includes the base. */}
            <div className="flex items-baseline gap-3 mt-2">
              <span data-testid="expense-summary-monthly" className="font-mono tabular-nums text-base">
                {formatCurrency(effectiveMonthly)}/mo
              </span>
              <span className="text-xs text-muted-foreground">
                Annual: <span data-testid="expense-summary-annual" className="font-mono tabular-nums">{formatCurrency(effectiveMonthly * 12)}</span>
              </span>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Additional time-bounded expense adjustments — add multiple periods to
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
