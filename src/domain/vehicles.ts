import type { Database } from '@/db/db';
import { VehicleSchema, type Vehicle } from '@/types/schema';

interface VehicleRow {
  id: number;
  household_id: number;
  owner_person_id: number | null;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  current_estimated_value: number | null;
  linked_loan_id: number | null;
  excluded_from_net_worth: number;
}

function rowToVehicle(row: VehicleRow): Vehicle {
  return VehicleSchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    name: row.name,
    year: row.year,
    make: row.make,
    model: row.model,
    purchaseDate: row.purchase_date,
    purchasePrice: row.purchase_price,
    currentEstimatedValue: row.current_estimated_value,
    linkedLoanId: row.linked_loan_id,
    excludedFromNetWorth: row.excluded_from_net_worth === 1,
  });
}

export class VehiclesRepo {
  constructor(private db: Database) {}

  async list(): Promise<Vehicle[]> {
    const rows = await this.db.select<VehicleRow>(
      'SELECT * FROM vehicles ORDER BY id ASC'
    );
    return rows.map(rowToVehicle);
  }

  async findById(id: number): Promise<Vehicle | null> {
    const rows = await this.db.select<VehicleRow>(
      'SELECT * FROM vehicles WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToVehicle(rows[0]);
  }

  async create(vehicle: Omit<Vehicle, 'id'>): Promise<number> {
    VehicleSchema.omit({ id: true }).parse(vehicle);
    const result = await this.db.execute(
      `INSERT INTO vehicles (
        household_id, owner_person_id, name, year, make, model,
        purchase_date, purchase_price, current_estimated_value,
        linked_loan_id, excluded_from_net_worth
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicle.householdId,
        vehicle.ownerPersonId ?? null,
        vehicle.name,
        vehicle.year ?? null,
        vehicle.make ?? null,
        vehicle.model ?? null,
        vehicle.purchaseDate ?? null,
        vehicle.purchasePrice ?? null,
        vehicle.currentEstimatedValue ?? null,
        vehicle.linkedLoanId ?? null,
        vehicle.excludedFromNetWorth ? 1 : 0,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create vehicle: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Vehicle, 'id' | 'householdId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Vehicle ${id} not found`);
    const merged = { ...existing, ...patch };
    VehicleSchema.parse(merged);

    await this.db.execute(
      `UPDATE vehicles SET
        owner_person_id = ?,
        name = ?,
        year = ?,
        make = ?,
        model = ?,
        purchase_date = ?,
        purchase_price = ?,
        current_estimated_value = ?,
        linked_loan_id = ?,
        excluded_from_net_worth = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.ownerPersonId ?? null,
        merged.name,
        merged.year ?? null,
        merged.make ?? null,
        merged.model ?? null,
        merged.purchaseDate ?? null,
        merged.purchasePrice ?? null,
        merged.currentEstimatedValue ?? null,
        merged.linkedLoanId ?? null,
        merged.excludedFromNetWorth ? 1 : 0,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM vehicles WHERE id = ?', [id]);
  }
}
