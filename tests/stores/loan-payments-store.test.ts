/**
 * Wave C review (MAJOR 3): behavioral coverage for the DC10 per-loan cache —
 * both of its mutations (loadForLoan clobbering sibling keys; remove filtering
 * the wrong slice) previously survived the full suite. Real :memory: DB (full
 * migration chain) per the snapshots-store sibling pattern — which also hosts
 * the MAJOR 1 balance-neutrality round trip (real store + repo, no mocks).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLoanPaymentsStore } from '@/stores/loan-payments-store';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { LoansRepo } from '@/domain/loans';
import { LoanType } from '@/types/enums';

describe('useLoanPaymentsStore (DC10 per-loan cache + MAJOR 1 coupled delete)', () => {
  let db: SqliteAdapter;
  let loan1: number;
  let loan2: number;

  const loanFixture = (name: string) => ({
    householdId: 1,
    obligorPersonId: null,
    name,
    type: LoanType.MORTGAGE,
    originalAmount: 400_000,
    currentBalance: 400_000,
    interestRate: 0.06,
    termMonths: 360,
    firstPaymentDate: '2026-01-01',
    monthlyPayment: 2398,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
  });

  const payment = (loanId: number, over: Record<string, unknown> = {}) => ({
    loanId,
    paymentDate: '2026-06-01',
    principal: 900,
    interest: 2100,
    extra: 100,
    source: 'AMORTIZATION' as const,
    ...over,
  });

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    const loans = new LoansRepo(db);
    loan1 = await loans.create(loanFixture('Mortgage'));
    loan2 = await loans.create(loanFixture('Auto'));
    useLoanPaymentsStore.setState({ paymentsByLoanId: {}, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('MAJOR 3a: loadForLoan(loan2) after loadForLoan(loan1) preserves loan1’s slice', async () => {
    const repo = new LoanPaymentsRepo(db);
    await repo.create(payment(loan1));
    await repo.create(payment(loan2, { paymentDate: '2026-05-01', principal: 400 }));

    const store = useLoanPaymentsStore.getState();
    await store.loadForLoan(loan1);
    await store.loadForLoan(loan2);

    const cache = useLoanPaymentsStore.getState().paymentsByLoanId;
    expect(cache[loan1]).toHaveLength(1);
    expect(cache[loan1][0].principal).toBe(900);
    expect(cache[loan2]).toHaveLength(1);
    expect(cache[loan2][0].principal).toBe(400);
  });

  it('MAJOR 3b: remove(id, loanId) filters ONLY that loan’s slice — siblings keep the same array', async () => {
    const repo = new LoanPaymentsRepo(db);
    const id1 = await repo.create(payment(loan1));
    await repo.create(payment(loan2, { paymentDate: '2026-05-01' }));

    const store = useLoanPaymentsStore.getState();
    await store.loadForLoan(loan1);
    await store.loadForLoan(loan2);
    const before = useLoanPaymentsStore.getState().paymentsByLoanId;

    await useLoanPaymentsStore.getState().remove(id1, loan1);

    const after = useLoanPaymentsStore.getState().paymentsByLoanId;
    expect(after[loan1]).toHaveLength(0);
    // Sibling slice untouched — the exact same array reference survives.
    expect(after[loan2]).toBe(before[loan2]);
    expect(after[loan2]).toHaveLength(1);
  });

  it('MAJOR 3c: remove for a never-cached loanId deletes the row but creates no cache entry', async () => {
    const repo = new LoanPaymentsRepo(db);
    const id1 = await repo.create(payment(loan1, { source: 'MANUAL' }));

    await useLoanPaymentsStore.getState().remove(id1, loan1);

    expect(await repo.listForLoan(loan1)).toHaveLength(0); // row gone
    // No phantom key: `paymentsByLoanId[loanId]` definedness is the
    // "loaded" signal the UI gates its empty copy on.
    expect(useLoanPaymentsStore.getState().paymentsByLoanId).toEqual({});
  });

  it('MAJOR 1: confirm → delete → re-confirm is balance-neutral (the CW26 loop never double-decrements)', async () => {
    const loans = new LoansRepo(db);
    const store = useLoanPaymentsStore.getState();
    const START = 400_000;
    const REDUCTION = 900 + 100; // principal + extra — the Monthly coupled pair

    // "Confirm" exactly as MonthlyMiniWindow does: payment INSERT + coupled
    // currentBalance decrement (LoanPaymentCard.confirm, insert-then-decrement).
    const confirm = async () => {
      const id = await store.create(payment(loan1));
      const loan = (await loans.findById(loan1))!;
      await loans.update(loan1, {
        currentBalance: Math.max(0, loan.currentBalance - REDUCTION),
      });
      return id;
    };

    const firstId = await confirm();
    expect((await loans.findById(loan1))!.currentBalance).toBe(START - REDUCTION);

    // Delete on /loans (the CW26 correction path) — must restore the
    // coupled decrement for this AMORTIZATION row.
    await useLoanPaymentsStore.getState().loadForLoan(loan1);
    await useLoanPaymentsStore.getState().remove(firstId, loan1);
    expect((await loans.findById(loan1))!.currentBalance).toBe(START);

    // Re-confirm in Monthly: the balance lands exactly one decrement below
    // start — never two.
    await confirm();
    expect((await loans.findById(loan1))!.currentBalance).toBe(START - REDUCTION);
  });

  it('MAJOR 1 guard: deleting a MANUAL row never touches the loan balance', async () => {
    const loans = new LoansRepo(db);
    const repo = new LoanPaymentsRepo(db);
    const id = await repo.create(payment(loan1, { source: 'MANUAL' }));
    await useLoanPaymentsStore.getState().loadForLoan(loan1);

    await useLoanPaymentsStore.getState().remove(id, loan1);

    expect((await loans.findById(loan1))!.currentBalance).toBe(400_000);
  });
});
