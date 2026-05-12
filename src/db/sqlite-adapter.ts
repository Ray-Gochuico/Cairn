import BetterSqlite3 from 'better-sqlite3';
import type { Database as DatabaseInterface, QueryResult } from './db';

export class SqliteAdapter implements DatabaseInterface {
  private db: BetterSqlite3.Database;

  constructor(path: string = ':memory:') {
    this.db = new BetterSqlite3(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare<unknown[]>(sql);
    const info = stmt.run(...params);
    return {
      lastInsertId: Number(info.lastInsertRowid) || undefined,
      rowsAffected: info.changes,
    };
  }

  async select<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare<unknown[], T>(sql);
    return stmt.all(...params);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // For tests: execute a multi-statement SQL string
  executeScript(sql: string): void {
    this.db.exec(sql);
  }
}
