import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { LoansRepo } from '@/domain/loans';
import { commitLoanImport } from '@/lib/import/commit/loan';
import type { LoanResolved } from '@/lib/import/validators/loan';
import type { PreviewRow } from '@/lib/import/types';
import { LoanType } from '@/types/enums';

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: LoanResolved,
  existingId?: number,
): PreviewRow<LoanResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

function baseResolved(name = 'Mortgage'): LoanResolved {
  return {
    householdId: 1,
    obligorPersonId: null,
    name,
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 350000,
    interestRate: 0.065,
    termMonths: 360,
    firstPaymentDate: '2024-01-01',
    monthlyPayment: 2528.27,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
  };
}

describe('commitLoanImport', () => {
  let db: SqliteAdapter;
  let repo: LoansRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new LoansRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts new loans', async () => {
    const res = await commitLoanImport(
      [
        makeRow(0, 'new', baseResolved('Mortgage')),
        makeRow(1, 'new', baseResolved('Car Loan')),
      ],
      { db, loans: repo, householdId: 1 },
    );
    expect(res.inserted).toBe(2);
    const all = await repo.list();
    expect(all.map((l) => l.name).sort()).toEqual(['Car Loan', 'Mortgage']);
  });

  it('updates an existing loan on status=update', async () => {
    const id = await repo.create(baseResolved('Mortgage'));
    const updated = baseResolved('Mortgage');
    updated.currentBalance = 300000;
    const res = await commitLoanImport(
      [makeRow(0, 'update', updated, id)],
      { db, loans: repo, householdId: 1 },
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.currentBalance).toBe(300000);
  });

  it('skips error rows', async () => {
    const res = await commitLoanImport(
      [makeRow(0, 'error', baseResolved('X'))],
      { db, loans: repo, householdId: 1 },
    );
    expect(res.skipped).toBe(1);
  });
});
