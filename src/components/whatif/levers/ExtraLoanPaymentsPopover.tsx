import { useEffect, useMemo, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useLoansStore } from '@/stores/loans-store';
import { buildLoanPreviewInput, previewExtraLoanPayment } from '@/lib/whatif/extra-loan-preview';
import type { ExtraLoanPayment } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

interface DraftRow {
  loanId: number;
  extraMonthly: number;
  start?: string;
  end?: string;
}

function mergeWithPersisted(loans: Array<{ id?: number }>, persisted: ExtraLoanPayment[]): DraftRow[] {
  const byLoan = new Map(persisted.map((p) => [p.loanId, p]));
  return loans
    .filter((l): l is { id: number } => l.id != null)
    .map((l) => {
      const existing = byLoan.get(l.id);
      return existing
        ? { loanId: l.id, extraMonthly: existing.extraMonthly, start: existing.start, end: existing.end }
        : { loanId: l.id, extraMonthly: 0 };
    });
}

function fmtMonth(monthISO: string): string {
  const [y, m] = monthISO.split('-').map(Number);
  const NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return y && m ? `${NAMES[m-1]} ${y}` : monthISO;
}

export default function ExtraLoanPaymentsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const loans     = useLoansStore((s) => s.loans);
  const active    = scenarios.find((s) => s.isActive);

  const [draft, setDraft] = useState<DraftRow[]>(() =>
    mergeWithPersisted(loans, active?.leverPayload.extraLoanPayments ?? []),
  );

  useEffect(() => {
    if (open) setDraft(mergeWithPersisted(loans, active?.leverPayload.extraLoanPayments ?? []));
  }, [open, loans, active?.leverPayload]);

  // Component code — the real-clock policy governs test files. The lib takes
  // the date explicitly so it stays clock-free testable.
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const previews = useMemo(() => {
    return draft.map((row) => {
      const loan = loans.find((l) => l.id === row.loanId);
      if (!loan) return null;
      // Wave-9 F5: re-anchor at the next due date so seasoned loans don't
      // preview payoffs in the past (and windowed levers actually apply).
      const preview = buildLoanPreviewInput(loan, todayIso);
      if (!preview) return null;
      return previewExtraLoanPayment(preview, row.extraMonthly, { start: row.start, end: row.end });
    });
  }, [draft, loans, todayIso]);

  const setRow = (i: number, patch: Partial<DraftRow>) => {
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const handleApply = async () => {
    if (!active?.id) return;
    const slice: ExtraLoanPayment[] = draft
      .filter((r) => r.extraMonthly > 0)
      .map((r) => {
        const out: ExtraLoanPayment = { loanId: r.loanId, extraMonthly: r.extraMonthly };
        if (r.start) out.start = r.start;
        if (r.end)   out.end   = r.end;
        return out;
      });
    await useScenariosStore.getState().updateLever(active.id, { extraLoanPayments: slice });
    onOpenChange(false);
  };

  const handleReset = () =>
    setDraft(mergeWithPersisted(loans, active?.leverPayload.extraLoanPayments ?? []));

  return (
    <LeverPopoverShell
      open={open}
      title="Extra loan payments"
      onOpenChange={onOpenChange}
      onApply={handleApply}
      onReset={handleReset}
    >
      <div className="space-y-2">
        {loans.length === 0 && (
          <p className="text-sm text-muted-foreground">No loans configured.</p>
        )}
        {draft.map((row, i) => {
          const loan = loans.find((l) => l.id === row.loanId);
          if (!loan) return null;
          const preview = previews[i];
          return (
            <div key={row.loanId} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end border-b py-2">
              <div className="font-medium">{loan.name}</div>
              <div>
                <Label htmlFor={`extra-${loan.id}`} className="text-xs">Extra / mo</Label>
                <Input
                  id={`extra-${loan.id}`}
                  type="number"
                  min={0}
                  step={25}
                  value={row.extraMonthly}
                  onChange={(e) => setRow(i, { extraMonthly: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div>
                <Label htmlFor={`start-${loan.id}`} className="text-xs">Start (YYYY-MM-DD)</Label>
                <Input
                  id={`start-${loan.id}`}
                  value={row.start ?? ''}
                  placeholder="always"
                  onChange={(e) => setRow(i, { start: e.target.value || undefined })}
                />
              </div>
              <div>
                <Label htmlFor={`end-${loan.id}`} className="text-xs">End (YYYY-MM-DD)</Label>
                <Input
                  id={`end-${loan.id}`}
                  value={row.end ?? ''}
                  placeholder="always"
                  onChange={(e) => setRow(i, { end: e.target.value || undefined })}
                />
              </div>
              <div className="text-sm">
                {preview && row.extraMonthly > 0 ? (
                  preview.capped ? (
                    /* Wave-7 W1 (same class as the Wave-6 DebtPayoffCard/Loans
                       guards): a capped simulation's tail is amortize()'s
                       safety cap, not a payoff — suppress the figures and say
                       why. House warning-note trio; AA-locked tokens. */
                    <span
                      role="note"
                      data-testid={`whatif-extra-never-payoff-${loan.id}`}
                      className="block rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-xs text-warning-foreground"
                    >
                      Never pays off at this payment + extra — the payment doesn't
                      cover monthly interest. Preview hidden.
                    </span>
                  ) : preview.baselineCapped ? (
                    /* Rescued: the extra makes an otherwise never-amortizing
                       loan pay off. "was <month> (–N months)" would difference
                       against the CAP, so the comparison is replaced with the
                       honest cause instead of a fake saving. */
                    <span
                      data-testid={`whatif-extra-rescued-${loan.id}`}
                      className="text-muted-foreground"
                    >
                      {`Payoff: ${fmtMonth(preview.payoffMonthISO)} — without this extra it never pays off`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {`Payoff: ${fmtMonth(preview.payoffMonthISO)} → was ${fmtMonth(preview.baselinePayoffMonthISO)} (–${preview.monthsSaved} months)`}
                    </span>
                  )
                ) : (
                  ''
                )}
              </div>
            </div>
          );
        })}
      </div>
    </LeverPopoverShell>
  );
}
