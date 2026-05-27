import BetterSqlite3 from 'better-sqlite3';
import type { Database as DatabaseInterface, QueryResult } from './db';

export class SqliteAdapter implements DatabaseInterface {
  private db: BetterSqlite3.Database;

  constructor(path: string = ':memory:') {
    this.db = new BetterSqlite3(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Match TauriAdapter — without busy_timeout, transient locks surface
    // as immediate "database is locked" errors with no retry. The test
    // adapter mostly runs against :memory: where contention is impossible,
    // but full PRAGMA parity keeps `tests/db/pragma-parity.test.ts` from
    // drifting between adapters (the same drift pattern that masked the
    // FK bug pre-Sprint 4). See Backend Wave-5 finding B.
    this.db.pragma('busy_timeout = 5000');
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
