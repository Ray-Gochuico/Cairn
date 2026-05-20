import type { Database } from '@/db/db';
import { MerchantOverrideSchema, type MerchantOverride } from '@/types/schema';

interface MerchantOverrideRow {
  id: number;
  household_id: number;
  merchant_pattern: string;
  category_id: number;
  created_from_correction_at: string;
}

function rowToMerchantOverride(row: MerchantOverrideRow): MerchantOverride {
  return MerchantOverrideSchema.parse({
    id: row.id,
    householdId: row.household_id,
    merchantPattern: row.merchant_pattern,
    categoryId: row.category_id,
    createdFromCorrectionAt: row.created_from_correction_at,
  });
}

export class MerchantOverridesRepo {
  constructor(private db: Database) {}

  async list(): Promise<MerchantOverride[]> {
    const rows = await this.db.select<MerchantOverrideRow>(
      'SELECT * FROM merchant_category_overrides ORDER BY id ASC',
    );
    return rows.map(rowToMerchantOverride);
  }

  async findById(id: number): Promise<MerchantOverride | null> {
    const rows = await this.db.select<MerchantOverrideRow>(
      'SELECT * FROM merchant_category_overrides WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToMerchantOverride(rows[0]);
  }

  async create(override: Omit<MerchantOverride, 'id' | 'createdFromCorrectionAt'>): Promise<number> {
    MerchantOverrideSchema.omit({ id: true, createdFromCorrectionAt: true }).parse(override);
    const result = await this.db.execute(
      `INSERT INTO merchant_category_overrides
        (household_id, merchant_pattern, category_id)
       VALUES (?, ?, ?)`,
      [override.householdId, override.merchantPattern, override.categoryId],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create merchant override: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM merchant_category_overrides WHERE id = ?', [id]);
  }

  /**
   * Upsert the learned category for a merchant pattern: if an override for
   * `pattern` exists, repoint it; otherwise insert. Called from the review
   * modal's correction flow.
   */
  async upsertForMerchant(householdId: number, pattern: string, categoryId: number): Promise<void> {
    const existing = await this.db.select<{ id: number }>(
      'SELECT id FROM merchant_category_overrides WHERE household_id = ? AND merchant_pattern = ?',
      [householdId, pattern],
    );
    if (existing.length > 0) {
      await this.db.execute(
        'UPDATE merchant_category_overrides SET category_id = ? WHERE id = ?',
        [categoryId, existing[0].id],
      );
    } else {
      await this.create({ householdId, merchantPattern: pattern, categoryId });
    }
  }
}
