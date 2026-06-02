//! Single-connection SQL batch primitive — the prod side of the prod↔test
//! SQL parity fix.
//!
//! THE BUG
//! -------
//! The app talks to SQLite in prod through `@tauri-apps/plugin-sql`, which
//! wraps a sqlx connection **pool** (`Pool<Sqlite>`, default
//! `max_connections = 10`). Every `db.execute()` call from JS is an
//! independent Tauri command that acquires a connection from the pool, runs
//! one statement, and releases it. The pool hands out a DIFFERENT physical
//! connection per call (FIFO idle queue) once it holds ≥ 2 live connections,
//! which it does by boot.
//!
//! The migration runner (and other call sites) expressed a transaction as
//! THREE separate `execute()` calls — `BEGIN`, the body, `COMMIT`. Under the
//! pool those route to three different connections: `BEGIN` opens a
//! transaction on connection A, the body autocommits on connection B, and
//! `COMMIT` errors on connection C. The "transaction" wrapped nothing. A
//! force-quit mid-migration could half-apply destructive schema changes with
//! no rollback. The test harness used a single synchronous connection and was
//! structurally blind to this.
//!
//! THE FIX
//! -------
//! `db_execute_batch` takes a whole list of statements and runs them on ONE
//! connection from the SAME pool `tauri-plugin-sql` already manages — looked
//! up out of the plugin's `DbInstances` Tauri state by the same `db` URL key
//! the JS side loaded (`"sqlite:finance.db"`). Reusing the plugin's pool
//! guarantees we operate on the exact same database file and connection
//! settings the rest of the app uses; we never open our own connection or
//! re-resolve the path.
//!
//! With `transaction = true` (the default on the JS side) the batch runs
//! inside a real `pool.begin()` transaction and is atomic: any error rolls the
//! whole batch back. With `transaction = false` the batch runs in order on a
//! single `pool.acquire()`d connection with no wrapping transaction, for
//! migrations (e.g. 0033) that carry their own `BEGIN`/`COMMIT`/`PRAGMA`
//! statements.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::{Pool, Sqlite};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// One statement plus its positional bind parameters, as sent from JS.
#[derive(Debug, Deserialize)]
pub struct BatchStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

/// Bind a JSON parameter onto a sqlx query exactly the way
/// `tauri-plugin-sql`'s own `execute`/`select` do, so a statement run through
/// this batch path binds identically to the same statement run through the
/// plugin's per-call path. In particular numbers bind as `f64` — matching the
/// plugin — which keeps integer/real affinity behaviour consistent across the
/// two code paths.
fn bind_params<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    values: &'q [JsonValue],
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for value in values {
        if value.is_null() {
            query = query.bind(None::<JsonValue>);
        } else if let Some(s) = value.as_str() {
            query = query.bind(s.to_owned());
        } else if let Some(number) = value.as_number() {
            query = query.bind(number.as_f64().unwrap_or_default());
        } else {
            query = query.bind(value.clone());
        }
    }
    query
}

/// Run `statements` on ONE connection from `pool`, in order.
///
/// `transaction = true`: wrap in a real transaction (`pool.begin()` …
/// `commit()`); any error rolls everything back atomically (the
/// `Transaction` rolls back on drop when we return early with `?`).
///
/// `transaction = false`: acquire a single connection and run each statement
/// on it with no wrapping transaction — for batches that manage their own
/// transaction/PRAGMA state.
///
/// This is the testable core; the Tauri command is a thin wrapper that looks
/// the pool up from plugin state and forwards here.
pub async fn run_batch(
    pool: &Pool<Sqlite>,
    statements: &[BatchStatement],
    transaction: bool,
) -> Result<(), String> {
    if transaction {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("db_execute_batch: begin failed: {e}"))?;
        for (i, stmt) in statements.iter().enumerate() {
            let query = bind_params(sqlx::query(&stmt.sql), &stmt.params);
            query.execute(&mut *tx).await.map_err(|e| {
                format!("db_execute_batch: statement {i} failed (rolled back): {e}")
            })?;
        }
        tx.commit()
            .await
            .map_err(|e| format!("db_execute_batch: commit failed: {e}"))?;
    } else {
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| format!("db_execute_batch: acquire failed: {e}"))?;
        for (i, stmt) in statements.iter().enumerate() {
            let query = bind_params(sqlx::query(&stmt.sql), &stmt.params);
            query
                .execute(&mut *conn)
                .await
                .map_err(|e| format!("db_execute_batch: statement {i} failed: {e}"))?;
        }
    }
    Ok(())
}

/// Tauri command exposed to JS as
/// `invoke('db_execute_batch', { db, statements, transaction })`.
///
/// `db` is the same connection URL the JS side passed to
/// `@tauri-apps/plugin-sql`'s `Database.load(...)` (e.g. `"sqlite:finance.db"`)
/// — it is the key the plugin stores its `Pool` under in `DbInstances`. We
/// fetch that exact pool and run the batch on it, guaranteeing we hit the same
/// database file as every other query in the app.
#[tauri::command]
pub async fn db_execute_batch(
    app: tauri::AppHandle,
    db: String,
    statements: Vec<BatchStatement>,
    transaction: bool,
) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let instances = instances.0.read().await;
    let pool = instances
        .get(&db)
        .ok_or_else(|| format!("db_execute_batch: database '{db}' not loaded"))?;

    match pool {
        DbPool::Sqlite(pool) => run_batch(pool, &statements, transaction).await,
        #[allow(unreachable_patterns)]
        _ => Err("db_execute_batch: non-sqlite pool is not supported".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Build a pool with `max_connections(2)` over a TEMP FILE. A file (not
    /// `sqlite::memory:`) is required: each pooled connection to a `:memory:`
    /// URL gets its OWN private database, so a table created on one connection
    /// is invisible to the next — which would make these tests pass for the
    /// wrong reason. A shared file is exactly the prod topology that exposed
    /// the original bug. The `>= 2` max_connections mirrors prod's
    /// multi-connection pool so the test can't accidentally degrade into the
    /// single-connection (test-adapter) case.
    async fn temp_file_pool() -> (Pool<Sqlite>, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().join("batch_test.db");
        let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect pool");
        // Keep the dir alive for the pool's lifetime by returning it.
        (pool, dir)
    }

    fn stmt(sql: &str) -> BatchStatement {
        BatchStatement {
            sql: sql.to_string(),
            params: vec![],
        }
    }

    fn stmt_p(sql: &str, params: Vec<JsonValue>) -> BatchStatement {
        BatchStatement {
            sql: sql.to_string(),
            params,
        }
    }

    async fn count_rows(pool: &Pool<Sqlite>, table: &str) -> i64 {
        use sqlx::Row;
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .expect("count query");
        row.get::<i64, _>("n")
    }

    #[tokio::test]
    async fn transaction_true_rolls_back_on_failure() {
        let (pool, _dir) = temp_file_pool().await;
        run_batch(
            &pool,
            &[stmt("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")],
            true,
        )
        .await
        .expect("create table");

        // A batch that writes two good rows then hits a failing statement.
        // With transaction:true the whole batch must roll back: zero rows.
        let result = run_batch(
            &pool,
            &[
                stmt_p("INSERT INTO t (v) VALUES (?)", vec![JsonValue::from("a")]),
                stmt_p("INSERT INTO t (v) VALUES (?)", vec![JsonValue::from("b")]),
                stmt("INSERT INTO this_table_does_not_exist VALUES (1)"),
            ],
            true,
        )
        .await;

        assert!(result.is_err(), "batch with a bad statement should error");
        assert_eq!(
            count_rows(&pool, "t").await,
            0,
            "transaction:true must roll back the good rows written before the failure"
        );
    }

    #[tokio::test]
    async fn transaction_true_commits_a_clean_batch() {
        let (pool, _dir) = temp_file_pool().await;
        run_batch(
            &pool,
            &[
                stmt("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"),
                stmt_p("INSERT INTO t (v) VALUES (?)", vec![JsonValue::from("a")]),
                stmt_p("INSERT INTO t (v) VALUES (?)", vec![JsonValue::from("b")]),
                stmt_p("INSERT INTO t (v) VALUES (?)", vec![JsonValue::from("c")]),
            ],
            true,
        )
        .await
        .expect("clean batch should commit");

        assert_eq!(count_rows(&pool, "t").await, 3);
    }

    #[tokio::test]
    async fn transaction_false_runs_self_managed_begin_commit() {
        // transaction:false is the self-managed-migration path (0033). The
        // batch carries its own BEGIN/COMMIT and a PRAGMA foreign_keys toggle;
        // run_batch must run them in order on one connection with no extra
        // wrap. (A wrap would either nest BEGINs — an error — or no-op the
        // PRAGMA.)
        let (pool, _dir) = temp_file_pool().await;
        run_batch(
            &pool,
            &[
                stmt("PRAGMA foreign_keys = OFF"),
                stmt("BEGIN"),
                stmt("CREATE TABLE sm (id INTEGER PRIMARY KEY, v TEXT)"),
                stmt_p("INSERT INTO sm (v) VALUES (?)", vec![JsonValue::from("x")]),
                stmt("COMMIT"),
                stmt("PRAGMA foreign_keys = ON"),
            ],
            false,
        )
        .await
        .expect("self-managed batch should succeed");

        assert_eq!(count_rows(&pool, "sm").await, 1);
    }
}
