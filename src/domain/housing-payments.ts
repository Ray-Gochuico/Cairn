import type { Database } from '@/db/db';
import {
  HousingPaymentSchema,
  HousingPaymentBaseSchema,
  type HousingPayment,
} from '@/types/schema';

interface HousingPaymentRow {
  id: number;
  household_id: number;
  owner_person_id: number | null;
  name: string;
  monthly_amount: number;
  start_date: string;
  end_date: string | null;
}

// Zod 4 disallows .omit() on a refined object schema, so we omit on the
// plain base and re-apply the end>=start refinement for create-shape writes.
const HousingPaymentCreateSchema = HousingPaymentBaseSchema
  .omit({ id: true })
  .refine((v) => v.endDate == null || v.endDate >= v.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

function rowToHousingPayment(row: HousingPaymentRow): HousingPayment {
  return HousingPaymentSchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    name: row.name,
    monthlyAmount: row.monthly_amount,
    startDate: row.start_date,
    endDate: row.end_date,
  });
}

export class HousingPaymentsRepo {
  constructor(private db: Database) {}

  async list(): Promise<HousingPayment[]> {
    const rows = await this.db.select<HousingPaymentRow>(
      'SELECT * FROM housing_payments ORDER BY id ASC',
    );
    return rows.map(rowToHousingPayment);
  }

  async findById(id: number): Promise<HousingPayment | null> {
    const rows = await this.db.select<HousingPaymentRow>(
      'SELECT * FROM housing_payments WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToHousingPayment(rows[0]);
  }

  async create(payment: Omit<HousingPayment, 'id'>): Promise<number> {
    HousingPaymentCreateSchema.parse(payment);
    const result = await this.db.execute(
      `INSERT INTO housing_payments (
        household_id, owner_person_id, name, monthly_amount, start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payment.householdId,
        payment.ownerPersonId ?? null,
        payment.name,
        payment.monthlyAmount,
        payment.startDate,
        payment.endDate ?? null,
      ],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create housing payment: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<HousingPayment, 'id' | 'householdId'>>,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Housing payment ${id} not found`);
    const merged = { ...existing, ...patch };
    HousingPaymentSchema.parse(merged);

    await this.db.execute(
      `UPDATE housing_payments SET
        owner_person_id = ?,
        name = ?,
        monthly_amount = ?,
        start_date = ?,
        end_date = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.ownerPersonId ?? null,
        merged.name,
        merged.monthlyAmount,
        merged.startDate,
        merged.endDate ?? null,
        id,
      ],
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM housing_payments WHERE id = ?', [id]);
  }
}
