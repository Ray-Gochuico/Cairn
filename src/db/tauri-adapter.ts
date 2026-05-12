import Database from '@tauri-apps/plugin-sql';
import type { Database as DatabaseInterface, QueryResult } from './db';

export class TauriAdapter implements DatabaseInterface {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async load(path: string = 'sqlite:finance.db'): Promise<TauriAdapter> {
    const db = await Database.load(path);
    return new TauriAdapter(db);
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const result = await this.db.execute(sql, params);
    return {
      lastInsertId: result.lastInsertId ?? undefined,
      rowsAffected: result.rowsAffected,
    };
  }

  async select<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.db.select<T[]>(sql, params);
    return rows;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
