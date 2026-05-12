import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { LoansRepo } from '@/domain/loans';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { LoanType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const makeLoan = async (
  repo: LoansRepo,
  overrides: Partial<Parameters<LoansRepo['create']>[0]> = {}
): Promise<number> => {
  return repo.create({
    householdId: 1,
    obligorPersonId: null,
    name: 'Mortgage',
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 400000,
    interestRate: 0.06,
    termMonths: 360,
    firstPaymentDate: '2024-06-01',
    monthlyPayment: 2398.20,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  });
};

describe('LoansRepo', () => {
  let db: SqliteAdapter;
  let repo: LoansRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new LoansRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no loans exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a loan and round-trips through list', async () => {
    const id = await makeLoan(repo);
    expect(id).toBeGreaterThan(0);

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Mortgage');
    expect(all[0].type).toBe(LoanType.MORTGAGE);
    expect(all[0].originalAmount).toBe(400000);
    expect(all[0].currentBalance).toBe(400000);
    expect(all[0].interestRate).toBe(0.06);
    expect(all[0].termMonths).toBe(360);
    expect(all[0].firstPaymentDate).toBe('2024-06-01');
    expect(all[0].monthlyPayment).toBe(2398.20);
    expect(all[0].extraPaymentDefault).toBe(0);
    expect(all[0].obligorPersonId).toBeNull();
    expect(all[0].linkedPropertyId).toBeNull();
    expect(all[0].linkedVehicleId).toBeNull();
  });

  it('finds a loan by id', async () => {
    const id = await makeLoan(repo, { name: 'Auto Loan', type: LoanType.AUTO });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Auto Loan');
    expect(found?.type).toBe(LoanType.AUTO);
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates an existing loan by merging fields', async () => {
    const id = await makeLoan(repo);
    await repo.update(id, { currentBalance: 395000, extraPaymentDefault: 100 });

    const updated = await repo.findById(id);
    expect(updated?.currentBalance).toBe(395000);
    expect(updated?.extraPaymentDefault).toBe(100);
    expect(updated?.originalAmount).toBe(400000);     // unchanged
    expect(updated?.monthlyPayment).toBe(2398.20);    // unchanged
  });

  it('deletes a loan', async () => {
    const id = await makeLoan(repo);
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });

  it('rejects invalid type enum value on create', async () => {
    await expect(
      makeLoan(repo, {
        // @ts-expect-error testing runtime validation
        type: 'NOT_A_LOAN_TYPE',
      })
    ).rejects.toThrow();
  });

  it('rejects negative current balance', async () => {
    await expect(
      makeLoan(repo, { currentBalance: -1 })
    ).rejects.toThrow();
  });

  it('projectedSchedule returns the amortized schedule from current balance', async () => {
    const id = await makeLoan(repo);
    const schedule = await repo.projectedSchedule(id);
    expect(schedule).toHaveLength(360);
    expect(schedule[0].principal + schedule[0].interest).toBeCloseTo(2398.20, 1);
    expect(schedule[359].balance).toBeCloseTo(0, 1);
  });

  it('projectedSchedule uses currentBalance (remaining), not originalAmount', async () => {
    // After paying down to a smaller balance, the schedule should reflect that
    const id = await makeLoan(repo);
    await repo.update(id, { currentBalance: 200000 });
    const schedule = await repo.projectedSchedule(id);
    // The first payment's interest should be on the reduced balance (200000 * 0.06 / 12 = 1000)
    expect(schedule[0].interest).toBeCloseTo(1000, 1);
  });

  it('projectedSchedule throws for unknown loan id', async () => {
    await expect(repo.projectedSchedule(9999)).rejects.toThrow();
  });
});

describe('LoanPaymentsRepo', () => {
  let db: SqliteAdapter;
  let loansRepo: LoansRepo;
  let repo: LoanPaymentsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    loansRepo = new LoansRepo(db);
    repo = new LoanPaymentsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForLoan returns empty array for fresh loan', async () => {
    const loanId = await makeLoan(loansRepo);
    expect(await repo.listForLoan(loanId)).toEqual([]);
  });

  it('creates a payment scoped to a loan', async () => {
    const loanId = await makeLoan(loansRepo);
    const id = await repo.create({
      loanId,
      paymentDate: '2024-06-01',
      principal: 398.20,
      interest: 2000.00,
      extra: 0,
      source: 'AMORTIZATION',
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.listForLoan(loanId);
    expect(all).toHaveLength(1);
    expect(all[0].principal).toBe(398.20);
    expect(all[0].interest).toBe(2000.00);
    expect(all[0].extra).toBe(0);
    expect(all[0].source).toBe('AMORTIZATION');
    expect(all[0].paymentDate).toBe('2024-06-01');
  });

  it('listForLoan filters by loanId and sorts by date ASC', async () => {
    const loanA = await makeLoan(loansRepo, { name: 'A' });
    const loanB = await makeLoan(loansRepo, { name: 'B' });

    await repo.create({ loanId: loanA, paymentDate: '2024-07-01', principal: 1, interest: 1, extra: 0, source: 'AMORTIZATION' });
    await repo.create({ loanId: loanA, paymentDate: '2024-06-01', principal: 1, interest: 1, extra: 0, source: 'AMORTIZATION' });
    await repo.create({ loanId: loanB, paymentDate: '2024-06-01', principal: 1, interest: 1, extra: 0, source: 'MANUAL' });

    const aPayments = await repo.listForLoan(loanA);
    expect(aPayments).toHaveLength(2);
    expect(aPayments.map((p) => p.paymentDate)).toEqual(['2024-06-01', '2024-07-01']);

    const bPayments = await repo.listForLoan(loanB);
    expect(bPayments).toHaveLength(1);
    expect(bPayments[0].source).toBe('MANUAL');
  });

  it('finds a payment by id', async () => {
    const loanId = await makeLoan(loansRepo);
    const id = await repo.create({
      loanId, paymentDate: '2024-06-01', principal: 100, interest: 50, extra: 25, source: 'IMPORTED',
    });
    const found = await repo.findById(id);
    expect(found?.principal).toBe(100);
    expect(found?.source).toBe('IMPORTED');
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates a payment by merging fields', async () => {
    const loanId = await makeLoan(loansRepo);
    const id = await repo.create({
      loanId, paymentDate: '2024-06-01', principal: 100, interest: 50, extra: 0, source: 'AMORTIZATION',
    });
    await repo.update(id, { extra: 200, source: 'MANUAL' });

    const updated = await repo.findById(id);
    expect(updated?.extra).toBe(200);
    expect(updated?.source).toBe('MANUAL');
    expect(updated?.principal).toBe(100);  // unchanged
  });

  it('deletes a payment', async () => {
    const loanId = await makeLoan(loansRepo);
    const id = await repo.create({
      loanId, paymentDate: '2024-06-01', principal: 100, interest: 50, extra: 0, source: 'AMORTIZATION',
    });
    await repo.delete(id);
    expect(await repo.listForLoan(loanId)).toEqual([]);
  });

  it('rejects invalid source enum value on create', async () => {
    const loanId = await makeLoan(loansRepo);
    await expect(
      repo.create({
        loanId, paymentDate: '2024-06-01', principal: 100, interest: 50, extra: 0,
        // @ts-expect-error testing runtime validation
        source: 'BOGUS_SOURCE',
      })
    ).rejects.toThrow();
  });

  it('enforces FK to loans (rejects payment with non-existent loanId)', async () => {
    await expect(
      repo.create({
        loanId: 9999, paymentDate: '2024-06-01', principal: 100, interest: 50, extra: 0, source: 'AMORTIZATION',
      })
    ).rejects.toThrow();
  });
});
