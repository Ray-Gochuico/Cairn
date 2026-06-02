import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';

const IDB_NAME = 'finance-app-shim';
const IDB_STORE = 'sqlite';

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const res = await fetch('/sql-wasm.wasm');
      if (!res.ok) throw new Error(`Failed to fetch sql-wasm.wasm: ${res.status}`);
      const wasmBinary = new Uint8Array(await res.arrayBuffer());
      return initSqlJs({ wasmBinary });
    })();
  }
  return sqlPromise;
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadPersisted(key: string): Promise<Uint8Array | null> {
  try {
    const idb = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[browser-shim/sql] IDB load failed; starting fresh:', e);
    return null;
  }
}

async function persist(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const idb = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[browser-shim/sql] IDB persist failed; data will not survive reload:', e);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(key: string, db: SqlJsDatabase): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persist(key, db.export());
  }, 250);
}

export interface QueryResult {
  lastInsertId: number | null;
  rowsAffected: number;
}

export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

export interface BatchOptions {
  transaction?: boolean;
}

export default class Database {
  private constructor(
    private readonly db: SqlJsDatabase,
    private readonly key: string,
  ) {}

  static async load(path: string): Promise<Database> {
    const SQL = await getSqlJs();
    const key = path.replace(/^sqlite:/, '');
    const persisted = await loadPersisted(key);
    const db = persisted ? new SQL.Database(persisted) : new SQL.Database();
    db.exec('PRAGMA foreign_keys = ON');
    return new Database(db, key);
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never[]);
      stmt.step();
    } finally {
      stmt.free();
    }
    const rowsAffected = this.db.getRowsModified();
    const idRows = this.db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertId = idRows[0]?.values[0]?.[0] as number | null | undefined;
    schedulePersist(this.key, this.db);
    return {
      lastInsertId: typeof lastInsertId === 'number' && lastInsertId > 0 ? lastInsertId : null,
      rowsAffected,
    };
  }

  async select<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params as never[]);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  // Mirrors the real `Database` interface's batch primitive. sql.js is a
  // single in-memory connection, so — like the test SqliteAdapter — it's
  // immune to the pool bug. The TauriAdapter delegates here in dev:browser
  // mode (it detects this method and calls it instead of invoking the Rust
  // command, which has no runtime in the browser). See tauri-adapter.ts.
  async executeBatch(statements: BatchStatement[], options: BatchOptions = {}): Promise<void> {
    const transaction = options.transaction ?? true;

    const runStatement = (sql: string, params: unknown[] = []): void => {
      const stmt = this.db.prepare(sql);
      try {
        stmt.bind(params as never[]);
        stmt.step();
      } finally {
        stmt.free();
      }
    };

    if (transaction) {
      // Bracket with explicit BEGIN/COMMIT on the single connection. On any
      // error, ROLLBACK so the batch is atomic. (transaction:false batches
      // carry their own BEGIN/COMMIT/PRAGMA and run unwrapped below.)
      runStatement('BEGIN');
      try {
        for (const { sql, params } of statements) {
          runStatement(sql, params);
        }
        runStatement('COMMIT');
      } catch (e) {
        try {
          runStatement('ROLLBACK');
        } catch {
          // Inner error may have already aborted the transaction; ignore the
          // "no transaction is active" noise so the original error surfaces.
        }
        throw e;
      }
    } else {
      for (const { sql, params } of statements) {
        runStatement(sql, params);
      }
    }

    schedulePersist(this.key, this.db);
  }

  async close(): Promise<void> {
    await persist(this.key, this.db.export());
    this.db.close();
  }
}
