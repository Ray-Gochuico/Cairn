import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type {
  BatchOptions,
  BatchStatement,
  Database as DatabaseInterface,
  QueryResult,
} from './db';

// Structural test for a `db` that already exposes a single-connection batch
// primitive. The browser shim's `Database` does (see
// src/lib/browser-shims/plugin-sql.ts); the real `@tauri-apps/plugin-sql`
// `Database` does NOT. We use this to decide between delegating to the shim
// (dev:browser, no Tauri runtime) and invoking the Rust command (prod).
interface HasExecuteBatch {
  executeBatch(statements: BatchStatement[], options?: BatchOptions): Promise<void>;
}

function hasExecuteBatch(db: unknown): db is HasExecuteBatch {
  return typeof (db as { executeBatch?: unknown }).executeBatch === 'function';
}

export class TauriAdapter implements DatabaseInterface {
  private db: Database;
  private dbUrl: string;

  private constructor(db: Database, dbUrl: string) {
    this.db = db;
    this.dbUrl = dbUrl;
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
    return new TauriAdapter(db, path);
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

  async executeBatch(statements: BatchStatement[], options: BatchOptions = {}): Promise<void> {
    const transaction = options.transaction ?? true;

    // dev:browser — the underlying `db` is the sql.js shim, which has its own
    // single-connection `executeBatch`. Delegate to it: there's no Tauri
    // runtime to `invoke` the Rust command against.
    if (hasExecuteBatch(this.db)) {
      await this.db.executeBatch(statements, { transaction });
      return;
    }

    // prod — `db` is the real `@tauri-apps/plugin-sql` Database, which routes
    // every `execute()` through a sqlx connection POOL (a different physical
    // connection per call). A multi-call BEGIN/body/COMMIT would scatter
    // across connections and wrap nothing. Instead, hand the whole batch to a
    // Rust command that pins it to ONE connection from the SAME pool the
    // plugin uses (looked up by `dbUrl` in the plugin's `DbInstances` state),
    // so the transaction is real. See src-tauri/src/db_batch.rs.
    await invoke('db_execute_batch', {
      db: this.dbUrl,
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      transaction,
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
