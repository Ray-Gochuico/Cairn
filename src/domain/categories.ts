import type { Database } from '@/db/db';
import { CategorySchema, type Category } from '@/types/schema';

interface CategoryRow {
  id: number;
  name: string;
  parent_category_id: number | null;
  color: string | null;
  icon: string | null;
  type: string;
  is_capital: number;
  system_managed: number;
}

function rowToCategory(row: CategoryRow): Category {
  return CategorySchema.parse({
    id: row.id,
    name: row.name,
    parentCategoryId: row.parent_category_id,
    color: row.color,
    icon: row.icon,
    type: row.type,
    isCapital: row.is_capital === 1,
    systemManaged: row.system_managed === 1,
  });
}

export class CategoriesRepo {
  constructor(private db: Database) {}

  async list(): Promise<Category[]> {
    const rows = await this.db.select<CategoryRow>(
      'SELECT * FROM categories ORDER BY id ASC',
    );
    return rows.map(rowToCategory);
  }

  async findById(id: number): Promise<Category | null> {
    const rows = await this.db.select<CategoryRow>(
      'SELECT * FROM categories WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToCategory(rows[0]);
  }

  async create(cat: Omit<Category, 'id'>): Promise<number> {
    CategorySchema.omit({ id: true }).parse(cat);
    const result = await this.db.execute(
      `INSERT INTO categories
        (name, parent_category_id, color, icon, type, is_capital, system_managed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        cat.name,
        cat.parentCategoryId ?? null,
        cat.color ?? null,
        cat.icon ?? null,
        cat.type,
        cat.isCapital ? 1 : 0,
        cat.systemManaged ? 1 : 0,
      ],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create category: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Category, 'id' | 'systemManaged'>>,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Category ${id} not found`);
    const merged = { ...existing, ...patch };
    CategorySchema.parse(merged);

    await this.db.execute(
      `UPDATE categories SET
        name = ?,
        parent_category_id = ?,
        color = ?,
        icon = ?,
        type = ?,
        is_capital = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.parentCategoryId ?? null,
        merged.color ?? null,
        merged.icon ?? null,
        merged.type,
        merged.isCapital ? 1 : 0,
        id,
      ],
    );
  }

  async delete(id: number): Promise<void> {
    const existing = await this.findById(id);
    if (existing?.systemManaged) {
      throw new Error('System-managed categories cannot be deleted');
    }
    await this.db.execute('DELETE FROM categories WHERE id = ?', [id]);
  }
}
