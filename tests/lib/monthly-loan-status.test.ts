/**
 * G4-09 (v1.8.0 W4): the Dashboard counts the loan payments /monthly still
 * lists as unrecorded. Real migrations, the real repos and stores, today a
 * literal day; a confirm is done step for step as LoanPaymentCard.confirm
 * does (the payment, then the balance decrement).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { LoansRepo } from '@/domain/loans';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { useLoanPaymentsStore } from '@/stores/loan-payments-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import MonthlyMiniWindow from '@/pages/MonthlyMiniWindow';
import { countOutstandingLoanPayments, nextLoanPaymentStatuses } from '@/lib/monthly-loan-status';
import { makeLoan } from '../factories';

const TODAY = '2026-11-15';

describe('nextLoanPaymentStatuses / countOutstandingLoanPayments (G4-09)', () => {
  let db: SqliteAdapter;
  let ids: number[];

  const count = async () =>
    countOutstandingLoanPayments(
      await nextLoanPaymentStatuses(useLoansStore.getState().loans, new LoansRepo(db), new LoanPaymentsRepo(db), TODAY),
    );

  async function confirmAsMonthlyDoes(id: number) {
    const loan = useLoansStore.getState().loans.find((l) => l.id === id)!;
    const e = (await new LoansRepo(db).projectedSchedule(id, TODAY))[0];
    await useLoanPaymentsStore.getState().create({
      loanId: id, paymentDate: e.paymentDate, principal: e.principal,
      interest: e.interest, extra: e.extra, source: 'AMORTIZATION',
    });
    await useLoansStore.getState().update(id, { currentBalance: Math.max(0, loan.currentBalance - (e.principal + e.extra)) });
  }

  beforeEach(async () => {
    // Every call passes TODAY; the fake Date keeps any default-day read on it too (CR-W4-6).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    const repo = new LoansRepo(db);
    ids = [];
    for (const [name, bal, first] of [
      ['Mortgage', 250_000, '2020-01-01'],
      ['Car loan', 12_000, '2024-03-20'],
      ['Student loan', 18_000, '2019-09-05'],
    ] as const) {
      ids.push(await repo.create(makeLoan({ name, currentBalance: bal, firstPaymentDate: first })));
    }
    await useLoansStore.getState().load();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('three active loans with nothing recorded count 3', async () => {
    expect(await count()).toBe(3);
  });

  it('two confirmed as /monthly confirms them count 1', async () => {
    await confirmAsMonthlyDoes(ids[0]);
    await confirmAsMonthlyDoes(ids[1]);
    expect(await count()).toBe(1);
  });

  it('all three confirmed count 0', async () => {
    for (const id of ids) await confirmAsMonthlyDoes(id);
    expect(await count()).toBe(0);
  });

  it('a paid-off loan and a loan whose schedule throws have no card and are not counted', async () => {
    await useLoansStore.getState().update(ids[0], { currentBalance: 0 });
    const statuses = await nextLoanPaymentStatuses(
      useLoansStore.getState().loans,
      { projectedSchedule: async (id, today) => (id === ids[1] ? Promise.reject(new Error('termMonths must be positive')) : new LoansRepo(db).projectedSchedule(id, today)) },
      new LoanPaymentsRepo(db),
      TODAY,
    );
    expect([statuses.get(ids[0]), statuses.get(ids[1])]).toEqual([null, null]);
    expect(countOutstandingLoanPayments(statuses)).toBe(1);
  });

  it('the next scheduled payment is the card, not a payment dated in the month being closed', async () => {
    // An AMORTIZATION row dated in October (the month being closed) does not
    // record the Dec 1 card /monthly offers on Nov 15.
    await new LoanPaymentsRepo(db).create({
      loanId: ids[0], paymentDate: '2026-10-01', principal: 500, interest: 1_000, extra: 0, source: 'AMORTIZATION',
    });
    const statuses = await nextLoanPaymentStatuses(useLoansStore.getState().loans, new LoansRepo(db), new LoanPaymentsRepo(db), TODAY);
    expect(statuses.get(ids[0])?.entry.paymentDate).toBe('2026-12-01');
    expect(statuses.get(ids[0])?.alreadyRecorded).toBe(false);
    expect(countOutstandingLoanPayments(statuses)).toBe(3);
  });
});

// Parity: the helper's count equals the loan cards /monthly still offers to
// Confirm (its own effect, MonthlyMiniWindow.tsx, is not moved onto the helper
// this wave). Fake Date only, at the same literal day as TODAY.
describe('G4-09 parity: the helper and the Monthly check-in agree', () => {
  let db: SqliteAdapter;
  const realLoads = {
    a: useAccountsStore.getState().load, s: useSnapshotsStore.getState().load, l: useLoansStore.getState().load,
    p: usePropertiesStore.getState().load, v: useVehiclesStore.getState().load,
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: realLoads.a } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: realLoads.s } as never);
    useLoansStore.setState({ loans: [], isLoading: false, error: null, load: realLoads.l } as never);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: realLoads.p } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: realLoads.v } as never);
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await db.close();
  });

  it('after two of three payments are confirmed, both read 1 outstanding (a paid-off loan has no card on either side)', async () => {
    const repo = new LoansRepo(db);
    const ids: number[] = [];
    for (const [name, bal, first] of [
      ['Mortgage', 250_000, '2020-01-01'],
      ['Car loan', 12_000, '2024-03-20'],
      ['Student loan', 18_000, '2019-09-05'],
      ['Paid-off loan', 0, '2018-02-10'],
    ] as const) {
      ids.push(await repo.create(makeLoan({ name, currentBalance: bal, firstPaymentDate: first })));
    }
    await useLoansStore.getState().load();
    for (const id of ids.slice(0, 2)) {
      const loan = useLoansStore.getState().loans.find((l) => l.id === id)!;
      const e = (await repo.projectedSchedule(id, TODAY))[0];
      await useLoanPaymentsStore.getState().create({
        loanId: id, paymentDate: e.paymentDate, principal: e.principal, interest: e.interest, extra: e.extra, source: 'AMORTIZATION',
      });
      await useLoansStore.getState().update(id, { currentBalance: Math.max(0, loan.currentBalance - (e.principal + e.extra)) });
    }
    const helper = countOutstandingLoanPayments(
      await nextLoanPaymentStatuses(useLoansStore.getState().loans, repo, new LoanPaymentsRepo(db), TODAY),
    );
    render(createElement(MemoryRouter, null, createElement(MonthlyMiniWindow)));
    await screen.findByText('Record loan payments');
    expect(await screen.findAllByText(/^Already recorded for /)).toHaveLength(2);
    const offered = screen.queryAllByRole('button', { name: /^Confirm .* payment$/ }).length;
    expect({ helper, offered, paidOffCard: screen.queryByText('Paid-off loan') }).toEqual({ helper: 1, offered: 1, paidOffCard: null });
  });
});
