import BetterSqlite3 from 'better-sqlite3';
import type {
  BatchOptions,
  BatchStatement,
  Database as DatabaseInterface,
  QueryResult,
} from './db';

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

  async executeBatch(statements: BatchStatement[], options: BatchOptions = {}): Promise<void> {
    const transaction = options.transaction ?? true;

    // better-sqlite3 is a single synchronous connection, so this adapter is
    // already immune to the pool bug. It serves as the test/prod-parity
    // reference: whatever atomicity behaviour it exhibits is the contract the
    // Rust prod path must match.
    if (transaction) {
      // Native better-sqlite3 transaction: BEGIN/COMMIT on the one connection,
      // automatic ROLLBACK if the function throws. Truly atomic. The wrapped
      // function MUST NOT contain explicit BEGIN/COMMIT/PRAGMA foreign_keys —
      // those belong on the transaction:false path (self-managed migrations).
      const run = this.db.transaction((stmts: BatchStatement[]) => {
        for (const { sql, params = [] } of stmts) {
          this.db.prepare(sql).run(...params);
        }
      });
      run(statements);
      return;
    }

    // transaction:false — run each statement in order on the one connection
    // with NO outer wrap, so a batch carrying its own BEGIN/COMMIT/PRAGMA
    // (e.g. migration 0033) behaves exactly as written.
    for (const { sql, params = [] } of statements) {
      this.db.prepare(sql).run(...params);
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // For tests: execute a multi-statement SQL string
  executeScript(sql: string): void {
    this.db.exec(sql);
  }
}
