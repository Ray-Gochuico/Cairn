//! Whole-file backup + safe restore for the live `finance.db`.
//!
//! WHY THIS EXISTS
//! ---------------
//! The app's data is 100%-local and irreplaceable. The pre-v1.0 "export" only
//! dumped in-memory store state for ~13 of ~30 tables to a lossy JSON file and
//! "restore" was a no-op. This module gives the app a REAL backup (a consistent
//! single-file copy of the entire database) and a corruption-safe restore.
//!
//! REACHING THE SAME DATABASE AS THE PLUGIN
//! ----------------------------------------
//! `db_backup` reuses the EXACT same `Pool<Sqlite>` that `tauri-plugin-sql`
//! manages in Tauri state — looked up out of the plugin's `DbInstances` by the
//! same `db` URL key the JS side loaded (`"sqlite:finance.db"`). Same pattern as
//! `db_batch::db_execute_batch`. That guarantees the backup is taken from the
//! live database file with the app's own connection settings, never a separately
//! re-opened copy.
//!
//! `db_restore` must REPLACE that live file. It resolves the live path the same
//! way the plugin does (`app.path().app_config_dir()` joined with the `db` URL's
//! path part — see `tauri-plugin-sql` 2.4.0 `wrapper.rs::path_mapper`), so the
//! file it overwrites is exactly the one every query in the app reads.
//!
//! RESTORE SAFETY (no half-swap corruption)
//! ----------------------------------------
//! 1. The backup is VALIDATED before anything destructive happens
//!    (`validate_backup_file`): `PRAGMA quick_check` must be `ok`, a
//!    `schema_migrations` table must exist, and the backup's `PRAGMA
//!    user_version` must not exceed the running build's `MAX_SCHEMA_VERSION`
//!    (refuse to restore a newer-schema backup into older code).
//! 2. The LIVE pool is closed FROM JS, before `db_restore` is invoked, via the
//!    plugin's own supported close path (`Database.close()` →
//!    `plugin:sql|close` → `pool.close().await`). We close from JS because the
//!    plugin's `DbPool::close()` is `pub(crate)` — not reachable from this
//!    crate — and the JS `close` command is the public, supported way to drain
//!    and close the exact pool the app uses. After it resolves, no connection
//!    holds a handle to the old inode or a dirty WAL. The closed pool stays in
//!    the plugin's `DbInstances` map; step 4's reload replaces it.
//! 3. `db_restore` re-validates (defence in depth) and then
//!    `replace_database_file` performs an ATOMIC swap that always leaves a valid
//!    `finance.db` (full ordering + crash analysis on that function): it stages
//!    the backup into a sibling temp file, clears the OLD (already-checkpointed)
//!    `-wal`/`-shm` sidecars, then `rename`s the temp file over `finance.db`.
//!    The live file is NEVER the copy target, so the in-copy truncation window a
//!    plain `fs::copy(backup, live)` would have is eliminated.
//! 4. The JS side then ALWAYS `window.location.reload()`s (success or failure —
//!    the pool was closed in step 2, so the session must re-init). On reboot
//!    `Database.load` issues `plugin:sql|load`, which `Pool::connect`s a FRESH
//!    pool over the file (the restored backup on success, or the still-intact
//!    original on a failed restore — H-1 guarantees one or the other, never a
//!    partial). The Rust process and its state survive a webview reload, so this
//!    re-init brings the DB back online — no app quit required.
//!
//! CRASH SAFETY: see `replace_database_file` for the per-step analysis. Every
//! failure point leaves `finance.db` either fully the original or fully the
//! restored backup — there is no state that is a partially-written main file and
//! none that leaves the restored file shadowed by a stale WAL.
//!
//! WHY THIS CAN'T CORRUPT EVEN IF THE JS CLOSE IS INCOMPLETE: `db_restore` only
//! ever swaps the live file AFTER its own re-validation passes, and the JS flow
//! awaits the plugin's `close` command (which resolves only once `pool.close()`
//! has drained every connection AND checkpointed the WAL) before invoking this
//! command — that checkpoint is what makes clearing the sidecars in step 3
//! lossless. The close → invoke → reload contract is load-bearing and enforced
//! in `src/lib/backup-restore.ts`.

use serde::Serialize;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Pool, Row, Sqlite};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// The highest schema version this build understands. Derived from the
/// migration list: it is the COUNT of registered migrations (currently 48),
/// which the JS migration runner stamps into `PRAGMA user_version` after
/// migrations apply (see `src/db/migrations.ts` `MAX_SCHEMA_VERSION` — the two
/// MUST stay in lock-step). `db_restore` refuses any backup whose stamped
/// `user_version` exceeds this, so older code never opens a newer-schema file.
///
/// Kept here (not read from JS) because the guard runs entirely in Rust before
/// the webview is even told to reload. If a future migration is added, bump
/// BOTH this constant and the JS `MAX_SCHEMA_VERSION`. Both sides are pinned to
/// the literal by tests so a one-sided bump fails CI: the Rust side by
/// `tests::max_schema_version_is_pinned_to_50` below, the JS side by
/// `tests/db/schema-version-guard.test.ts` (which also asserts the JS value
/// equals the migration count).
pub const MAX_SCHEMA_VERSION: i64 = 50;

/// Outcome of validating a candidate backup file, surfaced to JS so the UI can
/// show a specific message before the destructive confirm.
#[derive(Debug, Serialize)]
pub struct BackupValidation {
    pub ok: bool,
    pub user_version: i64,
    pub max_supported_version: i64,
    /// `None` when `ok`; otherwise a human-readable reason the file was rejected.
    pub reason: Option<String>,
}

/// Take a consistent whole-file backup of `pool`'s database into `dest`.
///
/// Uses SQLite's `VACUUM INTO`, which writes a fully-consistent, defragmented
/// copy of the entire database (every table, every index — all ~30 tables) to a
/// new file while the source stays open and writable. It runs in a single
/// implicit transaction, so the copy is a point-in-time snapshot even if other
/// connections are mid-write. `dest` MUST NOT already exist (VACUUM INTO errors
/// if it does), so callers write to a fresh timestamped filename.
///
/// This is the testable core; the Tauri command is a thin wrapper that looks the
/// pool up from plugin state and forwards here.
pub async fn backup_to(pool: &Pool<Sqlite>, dest: &Path) -> Result<(), String> {
    let dest_str = dest
        .to_str()
        .ok_or_else(|| "db_backup: destination path is not valid UTF-8".to_string())?;
    // VACUUM INTO does not accept a bound parameter for the path on all SQLite
    // builds; it takes a string literal. Single-quote-escape the path to avoid
    // breaking out of the literal. Paths are app-generated (app-data dir +
    // timestamp) or user-chosen via a save dialog, never raw SQL, but we escape
    // defensively regardless.
    let escaped = dest_str.replace('\'', "''");
    let sql = format!("VACUUM INTO '{escaped}'");
    sqlx::query(&sql)
        .execute(pool)
        .await
        .map_err(|e| format!("db_backup: VACUUM INTO failed: {e}"))?;
    Ok(())
}

/// Open `path` read-only and run the pre-restore safety checks WITHOUT mutating
/// it. Returns a `BackupValidation`; `ok == false` carries the rejection reason.
///
/// Checks, in order:
///   - the file opens as a SQLite database and `PRAGMA quick_check` returns `ok`
///     (a fast structural integrity scan — catches truncated/garbage files);
///   - a `schema_migrations` table exists (proves it's a Cairn database, not
///     some unrelated SQLite file);
///   - `PRAGMA user_version <= MAX_SCHEMA_VERSION` (don't load a newer-schema
///     backup into older code, which could silently misread columns).
pub async fn validate_backup_file(path: &Path) -> BackupValidation {
    let reject = |reason: String| BackupValidation {
        ok: false,
        user_version: 0,
        max_supported_version: MAX_SCHEMA_VERSION,
        reason: Some(reason),
    };

    let path_str = match path.to_str() {
        Some(s) => s,
        None => return reject("Backup path is not valid UTF-8.".to_string()),
    };

    // Read-only connection: never create, never write. `immutable=true` is
    // avoided so quick_check can still read the file normally; read_only is
    // enough to guarantee we don't mutate the candidate.
    let opts = match SqliteConnectOptions::from_str(&format!("sqlite:{path_str}")) {
        Ok(o) => o.read_only(true).create_if_missing(false),
        Err(e) => return reject(format!("Could not open backup: {e}")),
    };
    let mut conn = match opts.connect().await {
        Ok(c) => c,
        Err(e) => {
            return reject(format!(
                "This file could not be opened as a database: {e}"
            ))
        }
    };

    // quick_check: returns a single row 'ok' when structurally sound.
    match sqlx::query("PRAGMA quick_check").fetch_one(&mut conn).await {
        Ok(row) => {
            let result: String = row.try_get::<String, _>(0).unwrap_or_default();
            if result.to_ascii_lowercase() != "ok" {
                return reject(format!(
                    "The backup failed an integrity check (quick_check returned \"{result}\"). It may be corrupt."
                ));
            }
        }
        Err(e) => return reject(format!("Integrity check could not run: {e}")),
    }

    // schema_migrations presence — proves this is a Cairn DB.
    let has_migrations: i64 = match sqlx::query(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .fetch_one(&mut conn)
    .await
    {
        Ok(row) => row.try_get::<i64, _>(0).unwrap_or(0),
        Err(e) => return reject(format!("Could not inspect the backup's tables: {e}")),
    };
    if has_migrations == 0 {
        return reject(
            "This does not look like a Cairn backup (no schema_migrations table).".to_string(),
        );
    }

    // user_version downgrade guard.
    let user_version: i64 = match sqlx::query("PRAGMA user_version")
        .fetch_one(&mut conn)
        .await
    {
        Ok(row) => row.try_get::<i64, _>(0).unwrap_or(0),
        Err(e) => return reject(format!("Could not read the backup's schema version: {e}")),
    };

    // Best-effort close; ignore errors (we're only reading).
    let _ = conn.close().await;

    if user_version > MAX_SCHEMA_VERSION {
        return reject(format!(
            "This backup was created by a newer version of Cairn (schema {user_version}; this app supports up to {MAX_SCHEMA_VERSION}). Update Cairn, then restore."
        ));
    }

    BackupValidation {
        ok: true,
        user_version,
        max_supported_version: MAX_SCHEMA_VERSION,
        reason: None,
    }
}

/// Atomically replace `live` with the contents of `backup`, leaving a VALID
/// `finance.db` no matter where a failure occurs.
///
/// PRECONDITION: the live pool must already be closed (the JS step does this),
/// so (a) no connection holds an open handle to `live`/its WAL, and (b) the WAL
/// has been checkpointed into the main file by `pool.close()` — i.e. the
/// original `live` file is self-contained and the `-wal`/`-shm` sidecars are
/// stale/empty. Both facts are what make the deletion-before-rename ordering
/// below safe.
///
/// ORDERING (every crash point leaves a valid finance.db):
///   1. Copy `backup` → a temp file in the SAME directory (`<live>.restore-tmp`).
///      Crash here ⇒ `live` is byte-for-byte UNTOUCHED; only the temp file is
///      partial (it is overwritten/cleaned on the next attempt). We never write
///      through `live` directly, so the in-copy truncation window that a plain
///      `fs::copy(backup, live)` has is eliminated.
///   2. Delete the OLD `<live>-wal` / `-shm` sidecars. They were already
///      checkpointed into `live` by the pool close, so removing them strands no
///      data: if we crash after this but before the rename, `live` is still the
///      ORIGINAL, fully-valid database. Doing the delete BEFORE the rename (not
///      after) is deliberate — a stale WAL left next to the freshly-renamed file
///      would be replayed over it on reopen and corrupt the restore.
///   3. `rename(tmp, live)` — atomic on the same filesystem. Before it runs,
///      `live` is the intact original; after it returns, `live` IS the restored
///      backup, with no sidecars to shadow it. There is no intermediate state
///      that is a partially-written main file.
///
/// On any error we attempt to remove the temp file (best-effort) so a failed
/// restore doesn't litter the data dir; the live DB is reported untouched.
pub fn replace_database_file(backup: &Path, live: &Path) -> Result<(), String> {
    let tmp = restore_tmp_path(live);

    // 1. Stage the restore in a sibling temp file. A mid-copy failure here
    //    cannot corrupt `live` because `live` is never the copy target.
    if let Err(e) = std::fs::copy(backup, &tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "db_restore: failed to stage the backup (your data is unchanged): {e}"
        ));
    }

    // 2. Clear the OLD, already-checkpointed WAL sidecars BEFORE the rename so
    //    nothing can shadow the restored file. `live` is still the valid
    //    original at this point, so a failure here leaves recoverable data.
    for sidecar in sidecar_paths(live) {
        match std::fs::remove_file(&sidecar) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(format!(
                    "db_restore: could not clear stale WAL sidecar {} (your data is unchanged): {e}",
                    sidecar.display()
                ));
            }
        }
    }

    // 3. Atomic swap. Either `live` is the intact original (rename never ran) or
    //    it is the fully-restored backup (rename returned) — never a partial.
    if let Err(e) = std::fs::rename(&tmp, live) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "db_restore: failed to finalize the restore (your data is unchanged): {e}"
        ));
    }

    Ok(())
}

/// The same-directory temp path the restore is staged into before the atomic
/// rename. Same parent dir as `live` so `rename` stays on one filesystem.
fn restore_tmp_path(live: &Path) -> PathBuf {
    let as_str = live.to_string_lossy();
    PathBuf::from(format!("{as_str}.restore-tmp"))
}

/// The `-wal` and `-shm` sidecar paths for a SQLite main-db path.
fn sidecar_paths(live: &Path) -> [PathBuf; 2] {
    let as_str = live.to_string_lossy();
    [
        PathBuf::from(format!("{as_str}-wal")),
        PathBuf::from(format!("{as_str}-shm")),
    ]
}

/// Resolve the absolute on-disk path the plugin uses for a `sqlite:` `db` URL.
///
/// Mirrors `tauri-plugin-sql` 2.4.0 `wrapper.rs::path_mapper`: the path part
/// after `sqlite:` is joined onto `app.path().app_config_dir()`. Keep in sync if
/// the pinned plugin version changes how it resolves the file.
fn resolve_sqlite_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &str,
) -> Result<PathBuf, String> {
    let rel = db
        .split_once(':')
        .map(|(_, p)| p)
        .ok_or_else(|| format!("db_restore: '{db}' is not a sqlite: URL"))?;
    let mut base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("db_restore: could not resolve app config dir: {e}"))?;
    base.push(rel);
    Ok(base)
}

/// Clone the live `Pool<Sqlite>` out of plugin state by `db` URL. Mirrors
/// `db_batch`'s lookup so both commands operate on the exact same managed pool.
async fn pool_for<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &str,
) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let instances = instances.0.read().await;
    match instances
        .get(db)
        .ok_or_else(|| format!("database '{db}' not loaded"))?
    {
        DbPool::Sqlite(pool) => Ok(pool.clone()),
        #[allow(unreachable_patterns)]
        _ => Err("non-sqlite pool is not supported".to_string()),
    }
}

/// Tauri command: `invoke('db_backup', { db, dest })`.
///
/// `db` is the plugin connection URL (`"sqlite:finance.db"`); `dest` is an
/// ABSOLUTE destination path for the new backup file (must not already exist).
#[tauri::command]
pub async fn db_backup(app: tauri::AppHandle, db: String, dest: String) -> Result<(), String> {
    let pool = pool_for(&app, &db).await?;
    backup_to(&pool, Path::new(&dest)).await
}

/// Tauri command: `invoke('db_validate_backup', { path })`.
///
/// Read-only pre-flight the UI calls before showing the destructive confirm.
#[tauri::command]
pub async fn db_validate_backup(path: String) -> Result<BackupValidation, String> {
    Ok(validate_backup_file(Path::new(&path)).await)
}

/// Tauri command: `invoke('db_restore', { db, source })`.
///
/// CONTRACT: the JS caller MUST have already closed the live pool
/// (`Database.close()` → `plugin:sql|close`) and awaited it before invoking
/// this — see the module-level safety note and `src/lib/backup-restore.ts`.
/// This command re-validates `source` (defence in depth) and, only if valid,
/// replaces the live database file + clears its WAL sidecars. On success the JS
/// side reloads the webview to re-init on the restored database. Returns an
/// error (and leaves the live DB untouched) if validation fails.
#[tauri::command]
pub async fn db_restore(app: tauri::AppHandle, db: String, source: String) -> Result<(), String> {
    let source_path = PathBuf::from(&source);

    // 1. Re-validate BEFORE touching anything destructive (the UI validated
    //    too, but the file could have changed between pre-flight and confirm).
    let validation = validate_backup_file(&source_path).await;
    if !validation.ok {
        return Err(validation
            .reason
            .unwrap_or_else(|| "The selected file is not a valid Cairn backup.".to_string()));
    }

    // 2. Resolve the live file path the plugin uses.
    let live_path = resolve_sqlite_path(&app, &db)?;

    // Guard against a no-op self-restore that would truncate the live file
    // (copying a file onto itself via std::fs::copy is undefined/destructive).
    if let (Ok(a), Ok(b)) = (source_path.canonicalize(), live_path.canonicalize()) {
        if a == b {
            return Err("db_restore: the selected backup IS the live database.".to_string());
        }
    }

    // 3. Swap the file and clear stale sidecars. The live pool was closed by
    //    the JS caller before this invoke, so no handle pins the old file/WAL.
    replace_database_file(&source_path, &live_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn seeded_pool(path: &Path) -> Pool<Sqlite> {
        let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect pool");
        // A minimal Cairn-shaped DB: schema_migrations + a data table + rows,
        // and a stamped user_version so the downgrade guard has something real.
        sqlx::query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO schema_migrations (version) VALUES ('0001_initial')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO accounts (name) VALUES ('Checking'), ('Brokerage')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("PRAGMA user_version = {MAX_SCHEMA_VERSION}"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn count_rows(path: &Path, table: &str) -> i64 {
        let url = format!("sqlite://{}?mode=ro", path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open backup");
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(&pool)
            .await
            .expect("count");
        let n: i64 = row.get("n");
        pool.close().await;
        n
    }

    #[tokio::test]
    async fn backup_to_produces_a_consistent_copy_with_same_tables_and_rows() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("live.db");
        let dest = dir.path().join("backup.db");
        let pool = seeded_pool(&src).await;

        backup_to(&pool, &dest).await.expect("backup");

        assert!(dest.exists(), "backup file should exist");
        // Same tables present.
        assert_eq!(count_rows(&dest, "schema_migrations").await, 1);
        assert_eq!(count_rows(&dest, "accounts").await, 2);
        pool.close().await;
    }

    #[tokio::test]
    async fn backup_to_errors_when_dest_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("live.db");
        let dest = dir.path().join("backup.db");
        std::fs::write(&dest, b"already here").unwrap();
        let pool = seeded_pool(&src).await;

        let result = backup_to(&pool, &dest).await;
        assert!(result.is_err(), "VACUUM INTO must refuse an existing dest");
        pool.close().await;
    }

    #[tokio::test]
    async fn validate_accepts_a_good_backup() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("live.db");
        let dest = dir.path().join("backup.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &dest).await.unwrap();
        pool.close().await;

        let v = validate_backup_file(&dest).await;
        assert!(v.ok, "good backup should validate: {:?}", v.reason);
        assert_eq!(v.user_version, MAX_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn validate_rejects_a_non_database_file() {
        let dir = tempfile::tempdir().unwrap();
        let junk = dir.path().join("notadb.db");
        std::fs::write(&junk, b"this is not a sqlite file at all").unwrap();

        let v = validate_backup_file(&junk).await;
        assert!(!v.ok, "garbage file must be rejected");
        assert!(v.reason.is_some());
    }

    #[tokio::test]
    async fn validate_rejects_a_sqlite_file_without_schema_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let other = dir.path().join("other.db");
        let url = format!("sqlite://{}?mode=rwc", other.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE foo (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let v = validate_backup_file(&other).await;
        assert!(!v.ok, "a SQLite DB without schema_migrations must be rejected");
        assert!(v.reason.unwrap().to_lowercase().contains("cairn"));
    }

    #[tokio::test]
    async fn validate_rejects_a_newer_schema_backup() {
        let dir = tempfile::tempdir().unwrap();
        let newer = dir.path().join("newer.db");
        let url = format!("sqlite://{}?mode=rwc", newer.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("PRAGMA user_version = {}", MAX_SCHEMA_VERSION + 5))
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let v = validate_backup_file(&newer).await;
        assert!(!v.ok, "a newer-schema backup must be refused");
        assert!(v.reason.unwrap().to_lowercase().contains("newer"));
    }

    #[tokio::test]
    async fn replace_database_file_overwrites_target_and_clears_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.db");
        let live = dir.path().join("finance.db");

        // Build a real backup from a seeded pool.
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;

        // Pre-existing live file with DIFFERENT contents + stale sidecars.
        std::fs::write(&live, b"old database bytes").unwrap();
        let wal = dir.path().join("finance.db-wal");
        let shm = dir.path().join("finance.db-shm");
        std::fs::write(&wal, b"stale wal").unwrap();
        std::fs::write(&shm, b"stale shm").unwrap();

        replace_database_file(&backup, &live).expect("replace");

        // The live file now matches the backup byte-for-byte...
        let backup_bytes = std::fs::read(&backup).unwrap();
        let live_bytes = std::fs::read(&live).unwrap();
        assert_eq!(live_bytes, backup_bytes, "live file should equal the backup");
        // ...and opens as the restored DB with the seeded rows...
        assert_eq!(count_rows(&live, "accounts").await, 2);
        // ...and the stale sidecars are gone.
        assert!(!wal.exists(), "stale -wal must be deleted");
        assert!(!shm.exists(), "stale -shm must be deleted");
    }

    #[tokio::test]
    async fn replace_database_file_succeeds_when_no_sidecars_present() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.db");
        let live = dir.path().join("finance.db");
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;
        // No live file and no sidecars at all — a fresh restore target.
        replace_database_file(&backup, &live).expect("replace with no sidecars");
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    /// H-1: a FAILED restore must leave the ORIGINAL live database byte-for-byte
    /// intact (never a truncated/partial file). We force the staging copy to
    /// fail by making the live file's directory read-only, so the copy to the
    /// sibling `<live>.restore-tmp` cannot be created. The original `live` must
    /// survive unchanged because it is never the copy target.
    #[cfg(unix)]
    #[tokio::test]
    async fn replace_database_file_failed_copy_leaves_original_intact() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        // Subdirectory we can lock down without affecting the TempDir cleanup.
        let live_dir = dir.path().join("data");
        std::fs::create_dir(&live_dir).unwrap();

        // A real, valid backup elsewhere.
        let backup = dir.path().join("backup.db");
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;

        // A pre-existing live DB with KNOWN distinct contents.
        let live = live_dir.join("finance.db");
        let original_bytes = b"ORIGINAL-LIVE-DB-CONTENTS-do-not-clobber".to_vec();
        std::fs::write(&live, &original_bytes).unwrap();

        // Make the directory read-only so creating `<live>.restore-tmp` fails.
        let mut perms = std::fs::metadata(&live_dir).unwrap().permissions();
        perms.set_mode(0o500); // r-x------ : can traverse + read, cannot create
        std::fs::set_permissions(&live_dir, perms).unwrap();

        let result = replace_database_file(&backup, &live);

        // Restore failed...
        assert!(result.is_err(), "a copy into a read-only dir must fail");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("your data is unchanged"),
            "error should reassure the user: {msg}"
        );

        // ...restore permissions so we can read + assert + clean up.
        let mut perms = std::fs::metadata(&live_dir).unwrap().permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&live_dir, perms).unwrap();

        // The ORIGINAL live file is byte-for-byte untouched.
        let after = std::fs::read(&live).unwrap();
        assert_eq!(
            after, original_bytes,
            "the original live database must survive a failed restore unchanged"
        );
        // No temp file stranded next to it.
        assert!(
            !restore_tmp_path(&live).exists(),
            "the .restore-tmp staging file must not be left behind"
        );
    }

    /// H-1, Windows edition — the OTHER failure mode: step 3's `rename` over a
    /// live `finance.db` that another process holds open WITHOUT
    /// `FILE_SHARE_DELETE` (an AV scanner, the indexer, an Explorer preview
    /// pane). `share_mode(0)` withholds ALL sharing — including delete-sharing,
    /// which is specifically what blocks `MoveFileEx`'s replace (this is NOT a
    /// "deny write" scenario; a read-only open without delete-sharing is
    /// enough). Steps 1–2 are unaffected (the copy targets the sibling temp
    /// file; no sidecars exist), so the failure lands exactly on the rename,
    /// which must error and leave the original bytes intact.
    ///
    /// Compiled only on Windows; runs on `windows-latest` CI / the A4
    /// hardware pass, never on the macOS dev machines.
    #[cfg(windows)]
    #[tokio::test]
    async fn replace_database_file_rename_over_no_share_open_leaves_original_intact() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();

        // A real, valid backup elsewhere.
        let backup = dir.path().join("backup.db");
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;

        // A pre-existing live DB with KNOWN distinct contents.
        let live = dir.path().join("finance.db");
        let original_bytes = b"ORIGINAL-LIVE-DB-CONTENTS-do-not-clobber".to_vec();
        std::fs::write(&live, &original_bytes).unwrap();

        // Hold the live file open with NO sharing. While this handle is alive,
        // no other open/delete/replace of `live` may succeed — the same shape
        // as a third-party process pinning the DB without FILE_SHARE_DELETE.
        let guard = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&live)
            .expect("open the live db with share_mode(0)");

        let result = replace_database_file(&backup, &live);

        // The restore failed at the finalize step (the rename) — NOT earlier.
        // Don't pin the OS error code: depending on the Windows version the
        // rename surfaces 5 (ERROR_ACCESS_DENIED) or 32 (ERROR_SHARING_VIOLATION).
        assert!(result.is_err(), "rename over a no-share open file must fail");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("failed to finalize the restore"),
            "the failure must come from the rename step: {msg}"
        );
        assert!(
            msg.contains("your data is unchanged"),
            "error should reassure the user: {msg}"
        );

        // Release the no-share handle BEFORE reading the file back — while it
        // is held, even our own re-open for the assertion would be refused.
        drop(guard);

        // The ORIGINAL live file is byte-for-byte untouched.
        let after = std::fs::read(&live).unwrap();
        assert_eq!(
            after, original_bytes,
            "the original live database must survive a failed restore unchanged"
        );
        // No temp file stranded next to it (the error path cleans it up).
        assert!(
            !restore_tmp_path(&live).exists(),
            "the .restore-tmp staging file must not be left behind"
        );
    }

    /// The staging temp file must not be left behind after a SUCCESSFUL restore
    /// either (the rename consumes it).
    #[tokio::test]
    async fn replace_database_file_leaves_no_temp_file_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.db");
        let live = dir.path().join("finance.db");
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;

        replace_database_file(&backup, &live).expect("replace");
        assert!(
            !restore_tmp_path(&live).exists(),
            "the .restore-tmp staging file must be renamed away on success"
        );
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    /// M-3: pin the Rust schema-version constant to the literal so a one-sided
    /// bump (Rust-only) trips `cargo test` — not just JS-side review. The JS
    /// `MAX_SCHEMA_VERSION` is asserted equal to this literal AND to the
    /// migration count in `tests/db/schema-version-guard.test.ts`.
    #[test]
    fn max_schema_version_is_pinned_to_50() {
        assert_eq!(MAX_SCHEMA_VERSION, 50);
    }
}
