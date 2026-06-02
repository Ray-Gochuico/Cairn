export interface QueryResult {
  lastInsertId?: number;
  rowsAffected: number;
}

/** A single SQL statement plus its bound parameters, for `executeBatch`. */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

export interface BatchOptions {
  /**
   * Wrap the whole batch in a single BEGIN/COMMIT (atomic all-or-nothing,
   * rollback on any error). Defaults to TRUE. Set FALSE for self-managed
   * migrations (e.g. 0033) that contain their OWN BEGIN/COMMIT/PRAGMA — the
   * primitive then runs each statement in order with no outer wrap.
   */
  transaction?: boolean;
}

export interface Database {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run a list of statements, in order, on ONE physical connection.
   *
   * This exists because prod runs `@tauri-apps/plugin-sql` → a sqlx
   * connection POOL that hands out a DIFFERENT connection per `execute()`
   * call. Expressing a transaction as three separate `execute()` calls
   * (`BEGIN`, body, `COMMIT`) therefore scatters across connections in prod
   * and the "transaction" wraps NOTHING. `executeBatch` routes every
   * statement of the batch to a single connection so a transaction is real.
   *
   * `transaction` defaults to TRUE: the batch is atomic (rollback on any
   * error). When FALSE, statements run in order on one connection with no
   * outer wrap (for migrations that self-manage their own tx/PRAGMA state).
   */
  executeBatch(statements: BatchStatement[], options?: BatchOptions): Promise<void>;
  close(): Promise<void>;
}

let _db: Database | null = null;

export function setDatabase(db: Database): void {
  _db = db;
}

export function getDatabase(): Database {
  if (!_db) {
    throw new Error('Database not initialized. Call setDatabase() first.');
  }
  return _db;
}

export function isInitialized(): boolean {
  return _db !== null;
}
