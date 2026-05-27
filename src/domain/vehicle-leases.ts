import type { Database } from '@/db/db';
import {
  VehicleLeaseSchema,
  VehicleLeaseBaseSchema,
  type VehicleLease,
} from '@/types/schema';

interface VehicleLeaseRow {
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
const VehicleLeaseCreateSchema = VehicleLeaseBaseSchema
  .omit({ id: true })
  .refine((v) => v.endDate == null || v.endDate >= v.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

function rowToVehicleLease(row: VehicleLeaseRow): VehicleLease {
  return VehicleLeaseSchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    name: row.name,
    monthlyAmount: row.monthly_amount,
    startDate: row.start_date,
    endDate: row.end_date,
  });
}

export class VehicleLeasesRepo {
  constructor(private db: Database) {}

  async list(): Promise<VehicleLease[]> {
    const rows = await this.db.select<VehicleLeaseRow>(
      'SELECT * FROM vehicle_leases ORDER BY id ASC',
    );
    return rows.map(rowToVehicleLease);
  }

  async findById(id: number): Promise<VehicleLease | null> {
    const rows = await this.db.select<VehicleLeaseRow>(
      'SELECT * FROM vehicle_leases WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToVehicleLease(rows[0]);
  }

  async create(lease: Omit<VehicleLease, 'id'>): Promise<number> {
    VehicleLeaseCreateSchema.parse(lease);
    const result = await this.db.execute(
      `INSERT INTO vehicle_leases (
        household_id, owner_person_id, name, monthly_amount, start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        lease.householdId,
        lease.ownerPersonId ?? null,
        lease.name,
        lease.monthlyAmount,
        lease.startDate,
        lease.endDate ?? null,
      ],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create vehicle lease: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<VehicleLease, 'id' | 'householdId'>>,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Vehicle lease ${id} not found`);
    const merged = { ...existing, ...patch };
    VehicleLeaseSchema.parse(merged);

    await this.db.execute(
      `UPDATE vehicle_leases SET
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
    await this.db.execute('DELETE FROM vehicle_leases WHERE id = ?', [id]);
  }
}
