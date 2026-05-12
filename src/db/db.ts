export interface QueryResult {
  lastInsertId?: number;
  rowsAffected: number;
}

export interface Database {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
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
