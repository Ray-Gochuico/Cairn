import type { LoansRepo } from '@/domain/loans';
import type { LoanPaymentsRepo } from '@/domain/loan-payments';
import type { ScheduleEntry } from '@/lib/amortization';
import type { Loan } from '@/types/schema';

/**
 * G4-09 (v1.8.0 W4): /monthly's loan-card rule as a helper, so the Dashboard's
 * "Close {Month} — … record N loan payments" counts what the Monthly check-in
 * still lists as unrecorded.
 *
 * The body is MonthlyMiniWindow's loan effect, moved as is (the page keeps its
 * own copy this wave; a parity test pins that the two agree):
 *   - the card is the loan's next scheduled payment, projectedSchedule(id, today)[0];
 *   - it is recorded when an AMORTIZATION payment sits on that entry's date;
 *   - a loan whose schedule is empty (paid off) or throws (no valid term) has
 *     no card (null).
 */
export interface NextLoanPaymentStatus {
  entry: ScheduleEntry;
  alreadyRecorded: boolean;
}

export async function nextLoanPaymentStatuses(
  loans: ReadonlyArray<Loan>,
  loansRepo: Pick<LoansRepo, 'projectedSchedule'>,
  paymentsRepo: Pick<LoanPaymentsRepo, 'listForLoan'>,
  todayIso: string,
): Promise<Map<number, NextLoanPaymentStatus | null>> {
  const entries = await Promise.all(
    loans
      .filter((l): l is Loan & { id: number } => l.id !== undefined)
      .map(async (l) => {
        try {
          const schedule = await loansRepo.projectedSchedule(l.id, todayIso);
          const entry = schedule[0] ?? null;
          if (!entry) return [l.id, null] as const;
          const payments = await paymentsRepo.listForLoan(l.id);
          const alreadyRecorded = payments.some(
            (p) => p.paymentDate === entry.paymentDate && p.source === 'AMORTIZATION',
          );
          return [l.id, { entry, alreadyRecorded }] as const;
        } catch {
          return [l.id, null] as const;
        }
      }),
  );
  return new Map(entries);
}

/** The loan payments /monthly still shows as unrecorded: a card that is not yet recorded. */
export function countOutstandingLoanPayments(
  statuses: ReadonlyMap<number, NextLoanPaymentStatus | null>,
): number {
  let n = 0;
  for (const s of statuses.values()) if (s !== null && !s.alreadyRecorded) n += 1;
  return n;
}
