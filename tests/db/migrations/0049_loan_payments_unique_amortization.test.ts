import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

async function seedLoan(db: SqliteAdapter): Promise<number> {
  // 0001_initial seeds the singleton household row (id = 1) — reuse it.
  await db.execute(
    `INSERT INTO loans (household_id, name, type, original_amount, current_balance,
       interest_rate, term_months, first_payment_date, monthly_payment, extra_payment_default)
     VALUES (1, 'M', 'MORTGAGE', 300000, 279163, 0.06, 360, '2021-08-01', 1798.65, 0)`,
  );
  const rows = await db.select<{ id: number }>('SELECT id FROM loans LIMIT 1');
  return rows[0].id;
}

const PAYMENT = (loanId: number, source = 'AMORTIZATION') =>
  [
    `INSERT INTO loan_payments (loan_id, payment_date, principal, interest, extra, source)
    VALUES (?, '2026-08-01', 402.83, 1395.82, 0, ?)`,
    [loanId, source],
  ] as const;

describe('0049_loan_payments_unique_amortization', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
  });
  afterEach(async () => {
    await db.close();
  });

  it('rejects a duplicate AMORTIZATION row for the same (loan_id, payment_date)', async () => {
    await runMigrations(db, await loadAllMigrations());
    const loanId = await seedLoan(db);
    await db.execute(...PAYMENT(loanId));
    await expect(db.execute(...PAYMENT(loanId))).rejects.toThrow(/unique/i);
  });

  it('still allows same-day MANUAL rows (the index is partial)', async () => {
    await runMigrations(db, await loadAllMigrations());
    const loanId = await seedLoan(db);
    await db.execute(...PAYMENT(loanId, 'MANUAL'));
    await expect(db.execute(...PAYMENT(loanId, 'MANUAL'))).resolves.toBeDefined();
  });

  it('upgrade dedupes pre-existing AMORTIZATION duplicates, keeping the earliest row', async () => {
    const all = await loadAllMigrations();
    await runMigrations(db, all.slice(0, -1)); // everything up to 0048
    const loanId = await seedLoan(db);
    await db.execute(...PAYMENT(loanId));
    await db.execute(...PAYMENT(loanId)); // the M37 corruption, pre-index
    await runMigrations(db, all); // apply 0049
    const rows = await db.select<{ id: number }>(
      `SELECT id FROM loan_payments WHERE loan_id = ? AND source = 'AMORTIZATION' ORDER BY id`,
      [loanId],
    );
    expect(rows).toHaveLength(1);
  });

  it('is idempotent', async () => {
    await runMigrations(db, await loadAllMigrations());
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
