import type { Database } from '@/db/db';
import { LoanSchema, type Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';
import { amortize, type ScheduleEntry } from '@/lib/amortization';

interface LoanRow {
  id: number;
  household_id: number;
  obligor_person_id: number | null;
  name: string;
  type: LoanType;
  original_amount: number;
  current_balance: number;
  interest_rate: number;
  term_months: number;
  first_payment_date: string;
  monthly_payment: number;
  extra_payment_default: number;
  linked_property_id: number | null;
  linked_vehicle_id: number | null;
}

function rowToLoan(row: LoanRow): Loan {
  return LoanSchema.parse({
    id: row.id,
    householdId: row.household_id,
    obligorPersonId: row.obligor_person_id,
    name: row.name,
    type: row.type,
    originalAmount: row.original_amount,
    currentBalance: row.current_balance,
    interestRate: row.interest_rate,
    termMonths: row.term_months,
    firstPaymentDate: row.first_payment_date,
    monthlyPayment: row.monthly_payment,
    extraPaymentDefault: row.extra_payment_default,
    linkedPropertyId: row.linked_property_id,
    linkedVehicleId: row.linked_vehicle_id,
  });
}

export class LoansRepo {
  constructor(private db: Database) {}

  async list(): Promise<Loan[]> {
    const rows = await this.db.select<LoanRow>(
      'SELECT * FROM loans ORDER BY id ASC'
    );
    return rows.map(rowToLoan);
  }

  async findById(id: number): Promise<Loan | null> {
    const rows = await this.db.select<LoanRow>(
      'SELECT * FROM loans WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToLoan(rows[0]);
  }

  async create(loan: Omit<Loan, 'id'>): Promise<number> {
    LoanSchema.omit({ id: true }).parse(loan);
    const result = await this.db.execute(
      `INSERT INTO loans (
        household_id, obligor_person_id, name, type,
        original_amount, current_balance, interest_rate, term_months,
        first_payment_date, monthly_payment, extra_payment_default,
        linked_property_id, linked_vehicle_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loan.householdId,
        loan.obligorPersonId ?? null,
        loan.name,
        loan.type,
        loan.originalAmount,
        loan.currentBalance,
        loan.interestRate,
        loan.termMonths,
        loan.firstPaymentDate,
        loan.monthlyPayment,
        loan.extraPaymentDefault,
        loan.linkedPropertyId ?? null,
        loan.linkedVehicleId ?? null,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create loan: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Loan, 'id' | 'householdId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Loan ${id} not found`);
    const merged = { ...existing, ...patch };
    LoanSchema.parse(merged);

    await this.db.execute(
      `UPDATE loans SET
        obligor_person_id = ?,
        name = ?,
        type = ?,
        original_amount = ?,
        current_balance = ?,
        interest_rate = ?,
        term_months = ?,
        first_payment_date = ?,
        monthly_payment = ?,
        extra_payment_default = ?,
        linked_property_id = ?,
        linked_vehicle_id = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.obligorPersonId ?? null,
        merged.name,
        merged.type,
        merged.originalAmount,
        merged.currentBalance,
        merged.interestRate,
        merged.termMonths,
        merged.firstPaymentDate,
        merged.monthlyPayment,
        merged.extraPaymentDefault,
        merged.linkedPropertyId ?? null,
        merged.linkedVehicleId ?? null,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM loans WHERE id = ?', [id]);
  }

  /**
   * Project the remaining amortization schedule for a loan from its current
   * balance forward. Uses the loan's stored rate, term, first-payment date,
   * and default extra-payment amount. Callers (LoansTab, monthly mini-window)
   * use this to render the payoff curve and to auto-fill upcoming payments.
   *
   * Note: principal is the current balance (remaining), not the original
   * amount — what users care about is the schedule from today forward.
   */
  async projectedSchedule(id: number): Promise<ScheduleEntry[]> {
    const loan = await this.findById(id);
    if (!loan) throw new Error(`Loan ${id} not found`);
    const result = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: loan.firstPaymentDate,
      extraPayment: loan.extraPaymentDefault,
    });
    return result.schedule;
  }
}
