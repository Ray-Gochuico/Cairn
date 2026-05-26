import type { Database } from '@/db/db';
import { PropertySchema, type Property } from '@/types/schema';
import { PropertyType } from '@/types/enums';
import { AssetValueSnapshotsRepo } from './asset-value-snapshots';

interface PropertyRow {
  id: number;
  household_id: number;
  owner_person_id: number | null;
  name: string;
  type: PropertyType;
  address: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  current_estimated_value: number | null;
  linked_loan_id: number | null;
  excluded_from_net_worth: number;
}

function rowToProperty(row: PropertyRow): Property {
  return PropertySchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    name: row.name,
    type: row.type,
    address: row.address,
    purchaseDate: row.purchase_date,
    purchasePrice: row.purchase_price,
    currentEstimatedValue: row.current_estimated_value,
    linkedLoanId: row.linked_loan_id,
    excludedFromNetWorth: row.excluded_from_net_worth === 1,
  });
}

export class PropertiesRepo {
  constructor(private db: Database) {}

  async list(): Promise<Property[]> {
    const rows = await this.db.select<PropertyRow>(
      'SELECT * FROM properties ORDER BY id ASC'
    );
    return rows.map(rowToProperty);
  }

  async findById(id: number): Promise<Property | null> {
    const rows = await this.db.select<PropertyRow>(
      'SELECT * FROM properties WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToProperty(rows[0]);
  }

  async create(property: Omit<Property, 'id'>): Promise<number> {
    PropertySchema.omit({ id: true }).parse(property);
    const result = await this.db.execute(
      `INSERT INTO properties (
        household_id, owner_person_id, name, type, address,
        purchase_date, purchase_price, current_estimated_value,
        linked_loan_id, excluded_from_net_worth
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        property.householdId,
        property.ownerPersonId ?? null,
        property.name,
        property.type,
        property.address ?? null,
        property.purchaseDate ?? null,
        property.purchasePrice ?? null,
        property.currentEstimatedValue ?? null,
        property.linkedLoanId ?? null,
        property.excludedFromNetWorth ? 1 : 0,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create property: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Property, 'id' | 'householdId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Property ${id} not found`);
    const merged = { ...existing, ...patch };
    PropertySchema.parse(merged);

    await this.db.execute(
      `UPDATE properties SET
        owner_person_id = ?,
        name = ?,
        type = ?,
        address = ?,
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
        merged.type,
        merged.address ?? null,
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
    // Cascade dated value snapshots first — owner_type is a discriminated
    // union so there is no SQL FK to enforce this at the database layer.
    await new AssetValueSnapshotsRepo(this.db).deleteForOwner('PROPERTY', id);
    await this.db.execute('DELETE FROM properties WHERE id = ?', [id]);
  }
}
