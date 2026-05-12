import type { Database } from '@/db/db';
import { LoanPaymentSchema, type LoanPayment } from '@/types/schema';

interface LoanPaymentRow {
  id: number;
  loan_id: number;
  payment_date: string;
  principal: number;
  interest: number;
  extra: number;
  source: 'AMORTIZATION' | 'MANUAL' | 'IMPORTED';
}

function rowToLoanPayment(row: LoanPaymentRow): LoanPayment {
  return LoanPaymentSchema.parse({
    id: row.id,
    loanId: row.loan_id,
    paymentDate: row.payment_date,
    principal: row.principal,
    interest: row.interest,
    extra: row.extra,
    source: row.source,
  });
}

export class LoanPaymentsRepo {
  constructor(private db: Database) {}

  async listForLoan(loanId: number): Promise<LoanPayment[]> {
    const rows = await this.db.select<LoanPaymentRow>(
      'SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date ASC, id ASC',
      [loanId]
    );
    return rows.map(rowToLoanPayment);
  }

  async findById(id: number): Promise<LoanPayment | null> {
    const rows = await this.db.select<LoanPaymentRow>(
      'SELECT * FROM loan_payments WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToLoanPayment(rows[0]);
  }

  async create(payment: Omit<LoanPayment, 'id'>): Promise<number> {
    LoanPaymentSchema.omit({ id: true }).parse(payment);
    const result = await this.db.execute(
      `INSERT INTO loan_payments (loan_id, payment_date, principal, interest, extra, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payment.loanId,
        payment.paymentDate,
        payment.principal,
        payment.interest,
        payment.extra,
        payment.source,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create loan payment: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<LoanPayment, 'id' | 'loanId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`LoanPayment ${id} not found`);
    const merged = { ...existing, ...patch };
    LoanPaymentSchema.parse(merged);

    await this.db.execute(
      `UPDATE loan_payments SET
        payment_date = ?,
        principal = ?,
        interest = ?,
        extra = ?,
        source = ?
       WHERE id = ?`,
      [
        merged.paymentDate,
        merged.principal,
        merged.interest,
        merged.extra,
        merged.source,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM loan_payments WHERE id = ?', [id]);
  }
}
