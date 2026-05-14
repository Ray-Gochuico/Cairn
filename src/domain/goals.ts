import type { Database } from '@/db/db';
import { GoalSchema, type Goal } from '@/types/schema';
import type { GoalType } from '@/types/enums';

interface GoalRow {
  id: number;
  household_id: number;
  for_person_id: number | null;
  name: string;
  type: GoalType;
  target_amount: number;
  target_date: string;
  linked_account_ids: string; // JSON-encoded number[]
}

function rowToGoal(row: GoalRow): Goal {
  // linked_account_ids is JSON-encoded; tolerate malformed/non-array payloads
  // by falling back to []. Schema validation below catches anything stray.
  let linked: number[] = [];
  try {
    const parsed = JSON.parse(row.linked_account_ids);
    if (Array.isArray(parsed)) {
      linked = parsed.filter((x): x is number => typeof x === 'number');
    }
  } catch {
    // leave as []
  }
  return GoalSchema.parse({
    id: row.id,
    householdId: row.household_id,
    forPersonId: row.for_person_id,
    name: row.name,
    type: row.type,
    targetAmount: row.target_amount,
    targetDate: row.target_date,
    linkedAccountIds: linked,
  });
}

export class GoalsRepo {
  constructor(private db: Database) {}

  async list(): Promise<Goal[]> {
    const rows = await this.db.select<GoalRow>(
      'SELECT * FROM goals ORDER BY id ASC'
    );
    return rows.map(rowToGoal);
  }

  async findById(id: number): Promise<Goal | null> {
    const rows = await this.db.select<GoalRow>(
      'SELECT * FROM goals WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToGoal(rows[0]);
  }

  async create(goal: Omit<Goal, 'id'>): Promise<number> {
    GoalSchema.omit({ id: true }).parse(goal);
    const result = await this.db.execute(
      `INSERT INTO goals (
        household_id, for_person_id, name, type,
        target_amount, target_date, linked_account_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.householdId,
        goal.forPersonId ?? null,
        goal.name,
        goal.type,
        goal.targetAmount,
        goal.targetDate,
        JSON.stringify(goal.linkedAccountIds),
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create goal: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Goal, 'id' | 'householdId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Goal ${id} not found`);
    const merged = { ...existing, ...patch };
    GoalSchema.parse(merged);

    await this.db.execute(
      `UPDATE goals SET
        for_person_id = ?,
        name = ?,
        type = ?,
        target_amount = ?,
        target_date = ?,
        linked_account_ids = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.forPersonId ?? null,
        merged.name,
        merged.type,
        merged.targetAmount,
        merged.targetDate,
        JSON.stringify(merged.linkedAccountIds),
        id,
      ]
    );
  }

  async remove(id: number): Promise<void> {
    await this.db.execute('DELETE FROM goals WHERE id = ?', [id]);
  }
}
