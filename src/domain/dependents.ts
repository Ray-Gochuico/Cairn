import type { Database } from '@/db/db';
import { DependentSchema, type Dependent } from '@/types/schema';
import { DependentType } from '@/types/enums';

interface DependentRow {
  id: number;
  household_id: number;
  name: string;
  date_of_birth: string;
  type: DependentType;
}

function rowToDependent(row: DependentRow): Dependent {
  return DependentSchema.parse({
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    type: row.type,
  });
}

export class DependentsRepo {
  constructor(private db: Database) {}

  async list(): Promise<Dependent[]> {
    const rows = await this.db.select<DependentRow>(
      'SELECT * FROM dependents ORDER BY id ASC'
    );
    return rows.map(rowToDependent);
  }

  async create(d: Omit<Dependent, 'id'>): Promise<number> {
    DependentSchema.omit({ id: true }).parse(d);
    const result = await this.db.execute(
      `INSERT INTO dependents (household_id, name, date_of_birth, type)
       VALUES (?, ?, ?, ?)`,
      [d.householdId, d.name, d.dateOfBirth, d.type]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create dependent');
    }
    return result.lastInsertId;
  }

  async update(id: number, patch: Partial<Omit<Dependent, 'id' | 'householdId'>>): Promise<void> {
    const rows = await this.db.select<DependentRow>(
      'SELECT * FROM dependents WHERE id = ?', [id]
    );
    if (rows.length === 0) throw new Error(`Dependent ${id} not found`);
    const merged = { ...rowToDependent(rows[0]), ...patch };
    DependentSchema.parse(merged);

    await this.db.execute(
      `UPDATE dependents SET name = ?, date_of_birth = ?, type = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [merged.name, merged.dateOfBirth, merged.type, id]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM dependents WHERE id = ?', [id]);
  }
}
