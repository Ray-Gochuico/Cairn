import Database from '@tauri-apps/plugin-sql';
import type { Database as DatabaseInterface, QueryResult } from './db';

export class TauriAdapter implements DatabaseInterface {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async load(path: string = 'sqlite:finance.db'): Promise<TauriAdapter> {
    const db = await Database.load(path);
    // SQLite defaults `foreign_keys = OFF` per connection, and
    // `tauri-plugin-sql` (2.x) calls `Pool::connect` without any PRAGMA
    // setup. Without this, the 29 `ON DELETE CASCADE` / `ON DELETE SET NULL`
    // clauses declared in migration 0001 are silent no-ops in production —
    // tests and the browser shim both enable FKs at construction, so the
    // adapter drift was invisible until the 2026-05-27 backend review.
    // Migration 0030 sweeps the orphans that accumulated while this was off.
    await db.execute('PRAGMA foreign_keys = ON');
    // WAL + busy_timeout were missing from prod while the test adapter
    // (`SqliteAdapter`) has set both since project inception — same drift
    // pattern that caused the FK bug. Without WAL, a force-quit mid-write
    // can corrupt the rollback journal in rare cases; without busy_timeout,
    // transient locks (e.g. the post-launch market refresh holding a write
    // lock during a save) surface as "database is locked" errors with no
    // retry. Both are textbook SQLite-on-desktop best practices. Wave-3
    // backend review (2026-05-27).
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA busy_timeout = 5000');
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
