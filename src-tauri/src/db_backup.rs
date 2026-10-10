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
//! 3. `db_restore` re-validates (defence in depth), refuses while another
//!    connection (a second Cairn window, another program) has the live file
//!    open (v1.8.0 H2), and then
//!    `replace_database_file` performs an ATOMIC swap that always leaves a valid
//!    `finance.db` (full ordering + crash analysis on that function): it stages
//!    the backup into a sibling temp file THROUGH SQLite (`VACUUM INTO`, so a
//!    `-wal` beside the backup is read too — v1.7.2), sets the OLD `-wal`/`-shm` sidecars
//!    ASIDE (moved, put back if the swap fails, deleted only after it
//!    succeeds — v1.7.1 CR-U-15; neither move ever replaces a file, v1.8.0
//!    H2), then `rename`s the temp file over `finance.db`.
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
//! none that leaves the restored file shadowed by a stale WAL. Two exceptions,
//! each named: a `-wal` the put-back reports it could not move back (it stays
//! at its set-aside path, and the message says where, put_back_or_report),
//! and a crash between steps 2 and 4, which leaves the sidecars set aside:
//! the next launch removes the set-aside `-shm` (and the staged copy when no
//! `-wal` was set aside) and keeps a set-aside `-wal` for the next restore to
//! name (reconcile_interrupted_restore, v1.8.0 H2). The exclusivity check's
//! close normally drains the `-wal` into finance.db first, so finance.db is
//! whole on its own; a drain that stops part-way leaves it whole only
//! together with that set-aside `-wal`.
//!
//! WHY THIS CAN'T CORRUPT EVEN IF THE JS CLOSE IS INCOMPLETE: `db_restore` only
//! ever swaps the live file AFTER its own re-validation passes, and the JS flow
//! awaits the plugin's `close` command (which resolves only once `pool.close()`
//! has drained every connection AND checkpointed the WAL) before invoking this
//! command. The close drains only this window's pool, so the swap also asks
//! SQLite for the file's exclusive lock first and refuses while any other
//! connection holds it (refuse_if_open_elsewhere, v1.8.0 H2). On the
//! boot-screen path where no pool was ever loaded, no
//! checkpoint ran, which is why step 3 sets the sidecars aside instead of
//! deleting them: a failed swap puts them back, so the original data (file +
//! WAL) survives. The close → invoke → reload contract is load-bearing and
//! enforced in `src/lib/backup-restore.ts`.

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteLockingMode, SqlitePoolOptions};
use sqlx::{ConnectOptions, Connection, Pool, Row, Sqlite};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// The highest schema version this build understands. Derived from the
/// migration list: it is the COUNT of registered migrations (see
/// `src/db/migrations.ts` `MAX_SCHEMA_VERSION` — the two MUST stay in
/// lock-step). The JS migration runner stamps `PRAGMA user_version` inside each
/// migration's own batch (that migration's registry ordinal, v1.7.1 U3), so a
/// full run ends at this value and a file an interrupted update left partway
/// reads as the last migration that committed. `db_restore` refuses any backup
/// whose stamped `user_version` exceeds this, so older code never opens a
/// newer-schema file.
///
/// Kept here (not read from JS) because the guard runs entirely in Rust before
/// the webview is even told to reload. If a future migration is added, bump
/// BOTH this constant and the JS `MAX_SCHEMA_VERSION`. Both sides are pinned to
/// the literal by tests so a one-sided bump fails CI: the Rust side by
/// `tests::max_schema_version_is_pinned` below, the JS side by
/// `tests/db/schema-version-guard.test.ts` (which also asserts the JS value
/// equals the migration count).
pub const MAX_SCHEMA_VERSION: i64 = 55;

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
/// connections are mid-write. `dest` must not exist, or must be an empty file:
/// VACUUM INTO refuses any other file there (`output file already exists`, or
/// `file is not a database`), so callers write to a fresh timestamped
/// filename. "Save a copy…" therefore cannot replace a file the save dialog
/// agreed to replace (post-release review L11; recorded for a chip).
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

    if path.to_str().is_none() {
        return reject("Backup path is not valid UTF-8.".to_string());
    }

    // Read-only connection: never create, never write. `immutable=true` is
    // avoided so quick_check can still read the file normally (a `-wal`
    // beside it included); read_only is enough to guarantee we don't mutate
    // the candidate's data. Opened BY FILENAME (v1.7.2, L8): a `sqlite:` URL
    // would split the name at a '?' and percent-decode '%XX', so the file
    // checked could differ from the file restored.
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false);
    let mut conn = match opts.connect().await {
        Ok(c) => c,
        Err(e) => {
            return reject(format!(
                "This file could not be opened as a database: {e}"
            ))
        }
    };

    // The checks run inside one block, so the connection is closed and
    // awaited on EVERY exit below, a refusal included (v1.8.0 H2, v1.7.2
    // chip e): a connection that is only dropped is closed later on sqlx's
    // worker thread, and on Windows SQLite's open handle (no
    // FILE_SHARE_DELETE) can then refuse the removal of a staged file this
    // check just refused.
    let checked: Result<i64, BackupValidation> = async {
        // quick_check: returns a single row 'ok' when structurally sound.
        match sqlx::query("PRAGMA quick_check").fetch_one(&mut conn).await {
            Ok(row) => {
                let result: String = row.try_get::<String, _>(0).unwrap_or_default();
                if result.to_ascii_lowercase() != "ok" {
                    return Err(reject(format!(
                        "The backup failed an integrity check (quick_check returned \"{result}\"). It may be corrupt."
                    )));
                }
            }
            Err(e) => return Err(reject(format!("Integrity check could not run: {e}"))),
        }

        // schema_migrations presence — proves this is a Cairn DB.
        let has_migrations: i64 = match sqlx::query(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
        )
        .fetch_one(&mut conn)
        .await
        {
            Ok(row) => row.try_get::<i64, _>(0).unwrap_or(0),
            Err(e) => return Err(reject(format!("Could not inspect the backup's tables: {e}"))),
        };
        if has_migrations == 0 {
            return Err(reject(
                "This does not look like a Cairn backup (no schema_migrations table).".to_string(),
            ));
        }

        // user_version downgrade guard.
        let user_version: i64 = match sqlx::query("PRAGMA user_version")
            .fetch_one(&mut conn)
            .await
        {
            Ok(row) => row.try_get::<i64, _>(0).unwrap_or(0),
            Err(e) => return Err(reject(format!("Could not read the backup's schema version: {e}"))),
        };
        Ok(user_version)
    }
    .await;
    close_validator_connection(conn).await;
    let user_version = match checked {
        Ok(v) => v,
        Err(refused) => return refused,
    };

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

/// Close the validator's connection and wait for it (errors ignored: the
/// connection only read). A connection that is only dropped is closed later,
/// on sqlx's worker thread.
async fn close_validator_connection(conn: sqlx::SqliteConnection) {
    let _ = conn.close().await;
    #[cfg(test)]
    VALIDATOR_CLOSES.with(|n| n.set(n.get() + 1));
}

/// Atomically replace `live` with the contents of `backup`, leaving a VALID
/// `finance.db` no matter where a failure occurs — and never deleting the
/// replaced file's `-wal`/`-shm` before the swap has succeeded.
///
/// PRECONDITION (normal path): the live pool was closed by the JS step, so no
/// connection holds `live` and `pool.close()` checkpointed the WAL. On the
/// boot-screen path where the pool was never loaded (the tolerated not-loaded
/// close in src/lib/backup-restore.ts) NO checkpoint ran: a leftover `-wal`
/// may still hold committed frames. So the sidecars are SET ASIDE, never
/// deleted, until the swap has succeeded (v1.7.1 CR-U-15, U1-m23/m32).
///
/// ORDERING (every error return leaves the original data whole — except a
/// REPORTED put-back failure of the `-wal`, which names where it is (see
/// put_back_or_report); after a crash between steps 2 and 3, or 3 and 4,
/// the next launch removes the set-aside `-shm` (and the staged copy when no
/// `-wal` was set aside) and keeps a set-aside `-wal` for the next restore to
/// name (reconcile_interrupted_restore, v1.8.0 H2)):
///   0. Refuse before touching anything when `backup` IS the staging file
///      (`<live>.restore-tmp`), or when a set-aside `-wal` from an earlier
///      restore is still present (`<live>-wal.restore-old`): it may be the
///      only copy of that session's committed frames, and step 2 must never
///      overwrite it. The refusal names it and says to move it out of the
///      folder, then restore again (never 'try again': that button re-runs the
///      boot). A leftover `-shm` set-aside is the rebuildable index — no data
///      — so it never refuses: it is removed best-effort (CR-U-25).
///   1. Stage `backup` → a temp file in the SAME directory
///      (`<live>.restore-tmp`) THROUGH SQLite (v1.7.2, L1): `backup` is opened
///      read-only by filename and copied with `VACUUM INTO`, so committed
///      frames in a `-wal` beside a WAL-mode backup reach the staged file,
///      which is one self-contained rollback-mode file. VALIDATE the staged
///      file (the checks `validate_backup_file` runs) — it is the file step 3
///      puts in place (CR-172-1). Make it
///      owner-writable and flush it to stable storage (`sync_all`). A
///      failure here leaves `live` and its sidecars untouched (the temp file
///      is removed). `live` is never the copy target, so the in-copy
///      truncation window of a plain `fs::copy(backup, live)` does not exist.
///   2. MOVE the old `-wal` / `-shm` aside to `<sidecar>.restore-old` (a
///      missing sidecar is skipped), never replacing a file already there
///      (v1.8.0 H2, chip t). They must not sit next to the restored file — a
///      stale WAL would be replayed over it on reopen — but they are only
///      moved, so a failure here or in step 3 moves them back.
///   3. `rename(tmp, live)` — atomic on the same filesystem. Before it, `live`
///      is the intact original; after it, `live` IS the restored backup.
///   4. Only now delete the set-aside sidecars (they belonged to the replaced
///      file; best-effort).
///
/// On a failure in steps 2–3 every moved sidecar is moved back, never over a
/// sidecar created in the meantime (chip t). Every
/// sidecar that cannot go back is named with where it is (the file is kept).
/// "(your data is unchanged)" is dropped, and "could not be put back" used,
/// ONLY when the `-wal` is stuck; a stuck `-shm` alone is reported calmly
/// (see put_back_or_report, CR-U-23c).
pub async fn replace_database_file(backup: &Path, live: &Path) -> Result<(), String> {
    stage_restore(backup, live).await?;
    // Just before anything moves (v1.8.0 H2, chip p): refuse while another
    // connection has `live` open. The staged copy is removed; nothing else
    // was touched.
    if let Err(refusal) = refuse_if_open_elsewhere(live).await {
        let _ = std::fs::remove_file(restore_tmp_path(live));
        return Err(refusal);
    }
    // The two seams are made after the last await: a `&mut dyn FnMut` held
    // across an await would make the db_restore command's future !Send.
    swap_staged(live, &mut swap_move(live), &mut |p: &Path| real_sync(p))
}

/// v1.8.0 H2 (chip p): refuse while another connection has `live` open — a
/// second Cairn window (there is no single-instance guard, and the JS close
/// drains only this window's pool) or another program. Renaming over a file
/// another process holds leaves that process writing to a file that is no
/// longer in the folder, and its writes are lost.
///
/// The proof is SQLite's own lock: every connection to a WAL-mode file holds
/// a shared lock on it for as long as it is open, idle or not (Cairn opens
/// the live file in WAL mode, src/db/tauri-adapter.ts). One connection in
/// exclusive locking mode, with no busy wait, asks for the exclusive lock;
/// SQLite answers SQLITE_BUSY at once while any other connection holds it,
/// and then nothing was written. Any other answer — the file missing,
/// unreadable or not a database — says nothing about other connections, so
/// the restore goes ahead as before.
///
/// When nothing else holds the file, this connection is its last, and its
/// close checkpoints a `-wal` into the file and removes it — the drain the
/// JS close already performs on the Settings path. The data in the file is
/// the same; a restore from a startup-failure screen, where no pool was
/// loaded, then has no `-wal` left to set aside.
async fn refuse_if_open_elsewhere(live: &Path) -> Result<(), String> {
    let opts = SqliteConnectOptions::new()
        .filename(live)
        .create_if_missing(false)
        .busy_timeout(std::time::Duration::ZERO)
        .locking_mode(SqliteLockingMode::Exclusive);
    let held = match opts.connect().await {
        Err(e) => is_locked(&e),
        Ok(mut conn) => {
            let held = match sqlx::query("BEGIN EXCLUSIVE").execute(&mut conn).await {
                Ok(_) => {
                    let _ = sqlx::query("COMMIT").execute(&mut conn).await;
                    false
                }
                Err(e) => is_locked(&e),
            };
            let _ = conn.close().await;
            held
        }
    };
    if held {
        Err("db_restore: another Cairn window or another program has your data open. Close it, then restore again (your data is unchanged)".to_string())
    } else {
        Ok(())
    }
}

/// SQLITE_BUSY or SQLITE_LOCKED (any extended code of either).
fn is_locked(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .and_then(|d| d.code())
        .and_then(|code| code.parse::<i32>().ok())
        .is_some_and(|code| matches!(code & 0xff, 5 | 6))
}

/// The production `rename` seam of `swap_staged` (v1.8.0 H2, chip t): step 3
/// (the staged copy over `live`) is the one move that replaces a file; every
/// set-aside (step 2) and every put-back refuses to (`move_no_replace`).
fn swap_move(live: &Path) -> impl FnMut(&Path, &Path) -> std::io::Result<()> + '_ {
    move |from: &Path, to: &Path| {
        if to == live {
            std::fs::rename(from, to)
        } else {
            move_no_replace(from, to)
        }
    }
}

/// Move `from` to `to` without ever replacing a file at `to` (v1.8.0 H2,
/// chip t, U1F-m7): `rename(2)` and Windows' replacing move both overwrite
/// their destination, so a sidecar another connection created meanwhile
/// would be lost. `to` is linked to `from`'s data first, which fails with
/// `AlreadyExists` when a file is there, and only then is the `from` name
/// removed. If that removal fails, the new link is taken back, so the move
/// either happened or did not.
fn move_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::hard_link(from, to)?;
    if let Err(e) = std::fs::remove_file(from) {
        let _ = std::fs::remove_file(to);
        return Err(e);
    }
    Ok(())
}

/// Test seam: the whole swap with `rename` injected, so a test can fail one
/// chosen step through it; the flush is the production `real_sync`.
#[cfg(test)]
async fn replace_database_file_with(
    backup: &Path,
    live: &Path,
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    replace_database_file_io(backup, live, rename, &mut |p: &Path| real_sync(p)).await
}

/// Flush a file's data to stable storage (F_FULLFSYNC on Apple via std).
/// Opened for writing: Windows FlushFileBuffers needs a writable handle.
fn real_sync(p: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    SYNCED.with(|s| s.borrow_mut().push(p.to_path_buf()));
    std::fs::OpenOptions::new().write(true).open(p)?.sync_all()
}

/// CR-U-22: give the staged copy an owner-writable mode (unix: add 0o600;
/// Windows: clear Read-only) — the backup may be read-only.
fn make_owner_writable(p: &Path) -> std::io::Result<()> {
    let mut perm = std::fs::metadata(p)?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        perm.set_mode(perm.mode() | 0o600);
    }
    #[cfg(not(unix))]
    {
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
    }
    std::fs::set_permissions(p, perm)
}

#[cfg(test)]
thread_local! {
    /// CR-U-22: every path the production `real_sync` flushed, so a test can
    /// see that the public entry point syncs the staged copy.
    static SYNCED: std::cell::RefCell<Vec<PathBuf>> = const { std::cell::RefCell::new(Vec::new()) };
    /// v1.7.2 (CR-172-4): a test changes the staged file here, between the
    /// staging copy and its validation, to prove that what is swapped in is
    /// what was validated.
    static AFTER_STAGE: std::cell::RefCell<Option<fn(&Path)>> = const { std::cell::RefCell::new(None) };
    /// v1.8.0 H2 (v1.7.2 chip e): how many validator connections were closed
    /// and awaited, so a test can see that a refusal closes its connection too.
    static VALIDATOR_CLOSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// v1.8.0 H2 (chip v): every pause a put-back retry asked for. Under test
    /// a pause is recorded and skipped, so the failure-path tests do not
    /// sleep, unless `REAL_RETRY_PAUSES` is set (one test sleeps for real).
    static RETRY_PAUSES: std::cell::RefCell<Vec<std::time::Duration>> = const { std::cell::RefCell::new(Vec::new()) };
    static REAL_RETRY_PAUSES: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// v1.8.0 H2 (code review): a name `name_lookup` reports it cannot look
    /// at, standing in for an lstat that fails with something other than
    /// NotFound (a permission, an I/O error) on one name alone.
    static LOOKUP_FAILS: std::cell::RefCell<Option<fn(&Path) -> bool>> = const { std::cell::RefCell::new(None) };
}

/// Test seam: `replace_database_file_with` plus a `sync` seam for the staged
/// copy.
#[cfg(test)]
async fn replace_database_file_io(
    backup: &Path,
    live: &Path,
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
    sync: &mut dyn FnMut(&Path) -> std::io::Result<()>,
) -> Result<(), String> {
    stage_restore(backup, live).await?;
    swap_staged(live, rename, sync)
}

/// Steps 0-1 of `replace_database_file` up to the staged copy: refuse before
/// touching anything, then stage `backup` into `<live>.restore-tmp`. Every
/// error return leaves `live` and its sidecars untouched; a staging file it
/// created is removed when the removal succeeds, which is not guaranteed (a
/// leftover is removed again before the next restore stages).
async fn stage_restore(backup: &Path, live: &Path) -> Result<(), String> {
    let tmp = restore_tmp_path(live);
    let sidecars = sidecar_paths(live);
    let asides = [set_aside_path(&sidecars[0]), set_aside_path(&sidecars[1])];

    // 0a + 0b's refusal (`refuse_before_staging`). A leftover -shm set-aside
    // is SQLite's rebuildable index and holds no data, so it never refuses
    // (CR-U-25): it is removed here best-effort. One this removal cannot
    // delete could not be renamed over either (a locked file or folder
    // refuses both), so step 2, which no longer replaces a file (v1.8.0 H2,
    // chip t), refuses then with the -shm named.
    refuse_before_staging(backup, live)?;
    let [_, shm_aside] = &asides;
    if std::fs::symlink_metadata(shm_aside).is_ok() {
        let _ = std::fs::remove_file(shm_aside);
    }

    // 1. Stage the restore in a sibling temp file, THROUGH SQLite (v1.7.2,
    //    L1): `std::fs::copy` took the main file alone, so a backup with a
    //    `-wal` beside it (a raw copy of a data folder taken while Cairn was
    //    open) restored older than the file the validator had checked, or
    //    empty. A failure here cannot corrupt `live`: it is never the copy
    //    target. VACUUM INTO refuses a non-empty target, so a staging file an
    //    interrupted restore left is removed first (`fs::copy` overwrote it;
    //    step 0a refuses to restore FROM it). One Cairn cannot remove is
    //    named, with the same next step as a set-aside -wal (v1.8.0 H2, chip
    //    w): the staging failure it caused did not say which file was in the
    //    way.
    match std::fs::remove_file(&tmp) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(leftover_refusal(&tmp)),
    }
    if let Err(e) = stage_through_sqlite(backup, &tmp).await {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "db_restore: failed to stage the backup (your data is unchanged): {e}"
        ));
    }
    #[cfg(test)]
    AFTER_STAGE.with(|hook| {
        if let Some(f) = *hook.borrow() {
            f(&tmp)
        }
    });
    //    Then validate what was staged — the file step 3 puts in place, not
    //    the source it came from (CR-172-1): quick_check, schema_migrations,
    //    user_version <= MAX_SCHEMA_VERSION. A refusal removes the staging
    //    file; `live` and its sidecars have not been touched.
    let staged = validate_backup_file(&tmp).await;
    if !staged.ok {
        let _ = std::fs::remove_file(&tmp);
        let e = staged.reason.unwrap_or_default();
        return Err(format!(
            "db_restore: failed to stage the backup (your data is unchanged): {e}"
        ));
    }
    Ok(())
}

/// Step 0's refusals, which read the files and change nothing. `stage_restore`
/// runs them first, and `refuse_before_close` (db_restore_check) runs them
/// again before the JS caller closes the pool (v1.8.0 H2, chip v).
///   0a. Never restore FROM this module's own staging file (U1F-m9): step 1
///       removes a leftover staging file before staging, so restoring FROM
///       it would delete the file chosen.
///   0b. Never overwrite a set-aside -wal an earlier restore left: it may
///       hold that session's committed frames. The refusal names it and the
///       calm next step (CR-U-20a, U1F-m1/m19). A name Cairn cannot look
///       up counts as there (may_exist, v1.8.0 H2 code review).
fn refuse_before_staging(backup: &Path, live: &Path) -> Result<(), String> {
    let tmp = restore_tmp_path(live);
    if let (Ok(src), Ok(staging)) = (backup.canonicalize(), tmp.canonicalize()) {
        if src == staging {
            return Err(
                "db_restore: the selected file is Cairn's own restore staging file, not a backup (your data is unchanged)"
                    .to_string(),
            );
        }
    }
    let wal_aside = set_aside_path(&sidecar_paths(live)[0]);
    if may_exist(&wal_aside) {
        return Err(leftover_refusal(&wal_aside));
    }
    Ok(())
}

/// CR-U1-53 (as amended by CR-U-23d and CR-U-25): a file an earlier restore
/// left next to the data, named with the calm next step. Step 0b gives it for
/// a set-aside `-wal`; step 1 for a staging file it cannot remove (v1.8.0 H2).
fn leftover_refusal(leftover: &Path) -> String {
    format!(
        "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
        leftover.display()
    )
}

/// Step 1's copy (v1.7.2, L1; CR-172-1): open `backup` read-only BY FILENAME
/// (no URL parsing, L8) and `VACUUM INTO` `tmp` (`backup_to`). SQLite reads
/// a `-wal` beside a WAL-mode source; the output is one self-contained
/// rollback-mode file, created fresh, so no mode bits or file flags come
/// with it. The source is only read: its main file and `-wal` are never
/// written.
async fn stage_through_sqlite(backup: &Path, tmp: &Path) -> Result<(), String> {
    let opts = SqliteConnectOptions::new()
        .filename(backup)
        .read_only(true)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;
    let staged = backup_to(&pool, tmp).await;
    pool.close().await;
    staged
}

/// The rest of `replace_database_file`, on the staged `<live>.restore-tmp`:
/// step 1's permission fix and flush, then steps 2-4 (set the old sidecars
/// aside, swap, clean up). Synchronous: `rename` (the move seam: production
/// passes `swap_move`, which replaces a file only at step 3) and `sync` are
/// the test seams.
fn swap_staged(
    live: &Path,
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
    sync: &mut dyn FnMut(&Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let tmp = restore_tmp_path(live);
    let sidecars = sidecar_paths(live);
    let asides = [set_aside_path(&sidecars[0]), set_aside_path(&sidecars[1])];

    //    SQLite creates the staged file with its default mode less the
    //    process umask, so an unusual umask could still stage a read-only
    //    copy that cannot be opened for the flush below — and would become a
    //    read-only finance.db. Make it owner-writable first (CR-U-22).
    if let Err(e) = make_owner_writable(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "db_restore: failed to stage the backup (your data is unchanged): {e}"
        ));
    }
    //    Flush the staged copy to stable storage BEFORE anything moves, so a
    //    power cut right after the swap can never leave an unflushed
    //    finance.db (CR-U-20c, U1F-m3).
    if let Err(e) = sync(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "db_restore: failed to stage the backup (your data is unchanged): {e}"
        ));
    }

    // 2. Set the OLD sidecars aside (moved, never deleted) so nothing can
    //    shadow the restored file, while keeping them for a put-back. On a
    //    failure here or in step 3 the staged copy is removed only AFTER the
    //    put-back has run (v1.8.0 H2, chip r): until then it shows that the
    //    swap never ran, and the next launch keeps it beside a `-wal`
    //    set-aside it keeps (reconcile_interrupted_restore).
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (sidecar, aside) in sidecars.iter().zip(asides.iter()) {
        match rename(sidecar, aside) {
            Ok(()) => moved.push((sidecar.clone(), aside.clone())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let step = format!("could not set aside the WAL sidecar {}", sidecar.display());
                let report = put_back_or_report(&moved, rename, &step, &e);
                let _ = std::fs::remove_file(&tmp);
                return Err(report);
            }
        }
    }

    // 3. Atomic swap. Either `live` is the intact original (rename never ran) or
    //    it is the fully-restored backup (rename returned) — never a partial.
    if let Err(e) = rename(&tmp, live) {
        let report = put_back_or_report(&moved, rename, "failed to finalize the restore", &e);
        let _ = std::fs::remove_file(&tmp);
        return Err(report);
    }

    // 4. The swap succeeded: the set-aside sidecars belonged to the replaced
    //    file. Best-effort removal (a leftover only makes the NEXT restore
    //    refuse at step 0, naming the file).
    for (_, aside) in &moved {
        let _ = std::fs::remove_file(aside);
    }
    Ok(())
}

/// Move every set-aside sidecar back (newest move first; in production never
/// over a file already there, chip t) and build the
/// error. "(your data is unchanged)" is claimed unless the `-wal` could not
/// go back; a sidecar that could not go back is named with where it is —
/// kept, never deleted. The `-shm` is SQLite's rebuildable wal-index and
/// holds no data, so a stuck `-shm` alone is reported calmly, never with the
/// data phrase (CR-U-23c). The phrase "could not be put back" is read by
/// the JS notices (src/db/boot-error-screen.ts,
/// src/components/settings/DataSection.tsx) to drop their "your data was not
/// changed" line, and by src/components/layout/RestoreProblemNote.tsx to
/// decide whether to show at all; keep them in sync.
fn put_back_or_report(
    moved: &[(PathBuf, PathBuf)],
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
    step: &str,
    e: &std::io::Error,
) -> String {
    let mut stuck: Vec<String> = Vec::new();
    let mut wal_stuck = false;
    for (sidecar, aside) in moved.iter().rev() {
        if let Err(back) = put_back_one(rename, aside, sidecar) {
            if !sidecar.to_string_lossy().ends_with("-shm") {
                wal_stuck = true;
            }
            stuck.push(format!(
                "{} is at {} ({back})",
                sidecar.display(),
                aside.display()
            ));
        }
    }
    if stuck.is_empty() {
        format!("db_restore: {step} (your data is unchanged): {e}")
    } else if !wal_stuck {
        format!(
            "db_restore: {step} (your data is unchanged): {e}. The index file {}; SQLite rebuilds it from your data",
            stuck.join("; ")
        )
    } else {
        format!(
            "db_restore: {step}: {e}. Part of your current data could not be put back: {}",
            stuck.join("; ")
        )
    }
}

/// The pauses before the second and third try of a failed put-back (v1.8.0
/// H2, chip v): a virus scanner or the indexer can hold a file for a moment.
const PUT_BACK_RETRY_PAUSES: [std::time::Duration; 2] =
    [std::time::Duration::from_millis(50), std::time::Duration::from_millis(200)];

/// Move one set-aside sidecar back, trying again after each pause in
/// `PUT_BACK_RETRY_PAUSES`. A file already at the sidecar's name
/// (`AlreadyExists`) or a set-aside file that is gone (`NotFound`) does not
/// change with a pause, so either is reported at once.
fn put_back_one(
    rename: &mut dyn FnMut(&Path, &Path) -> std::io::Result<()>,
    aside: &Path,
    sidecar: &Path,
) -> std::io::Result<()> {
    let mut result = rename(aside, sidecar);
    for pause in PUT_BACK_RETRY_PAUSES {
        match &result {
            Err(e) if !matches!(e.kind(), std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::NotFound) => {
                pause_before_retry(pause);
                result = rename(aside, sidecar);
            }
            _ => break,
        }
    }
    result
}

/// The pause before a put-back's next try. Under test it is recorded
/// (`RETRY_PAUSES`) and slept only when `REAL_RETRY_PAUSES` is set, so the
/// failure-path tests do not sleep and one test times the real pauses.
fn pause_before_retry(pause: std::time::Duration) {
    #[cfg(test)]
    {
        RETRY_PAUSES.with(|p| p.borrow_mut().push(pause));
        if !REAL_RETRY_PAUSES.with(|r| r.get()) {
            return;
        }
    }
    std::thread::sleep(pause);
}

/// v1.8.0 H2 (chip r, U1F-m3): tidy what a restore an earlier run of Cairn
/// left between its steps (a kill or a power cut mid-swap). lib.rs runs it at
/// startup, before tauri-plugin-sql can open the file: the plugin opens a
/// database only when the webview loads it (`plugins.sql.preload` is not
/// set), and the setup hook runs before the event loop delivers any webview
/// call.
///
/// It removes only files that hold no data and that SQLite never reads as
/// finance.db's own: the `-shm` set-aside (the rebuildable index, CR-U-25),
/// and the staged copy (a copy of the chosen backup, which step 1 of every
/// restore removes anyway) once no `-wal` set-aside is beside it. It never
/// moves, replaces or removes `finance.db`, its `-wal` or `-shm`, or a `-wal`
/// set-aside (CR-H2-3; second-round plan review): nothing on disk proves
/// which file a `-wal` set-aside belongs to (a copy put in place by hand
/// keeps its older date and, as a Cairn backup, a rollback-mode header, and
/// SQLite replays a `-wal` found beside either), and another Cairn window's
/// restore may be between two of its steps right now (there is no
/// single-instance guard). So a `-wal` set-aside stays exactly as the crash
/// left it, as in v1.7.2, and the next restore names it (CR-U1-53). This
/// build's own crashes rarely leave one: the exclusivity check's close
/// drains the `-wal` into finance.db before step 2 (refuse_if_open_elsewhere).
///
/// Silent by design: nothing it removes holds data.
pub fn reconcile_interrupted_restore(live: &Path) {
    let tmp = restore_tmp_path(live);
    let [wal, shm] = sidecar_paths(live);
    let (wal_aside, shm_aside) = (set_aside_path(&wal), set_aside_path(&shm));
    // A removal target is read as present only when its lookup succeeds; the
    // -wal set-aside, which may hold data, whenever its lookup is not
    // NotFound (may_exist).
    let present = |p: &Path| name_lookup(p).is_ok();
    if !may_exist(&wal_aside) && !present(&shm_aside) {
        return; // nothing was set aside: no restore stopped mid-swap
    }
    // The staged copy goes only when no -wal set-aside is beside it: nothing
    // that holds data was then set aside, so finance.db is whole on its own
    // at either crash point. Beside a kept -wal set-aside it stays, the sign
    // that step 3 never ran.
    if present(&tmp) && !may_exist(&wal_aside) {
        let _ = std::fs::remove_file(&tmp);
    }
    if present(&shm_aside) {
        let _ = std::fs::remove_file(&shm_aside);
    }
}

/// The resolve-then-tidy step lib.rs's setup runs: the live path is
/// resolved exactly as `db_restore` and the plugin resolve it. A path that
/// cannot be resolved means the plugin cannot open the database either, so
/// there is nothing to tidy.
pub fn reconcile_at_startup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(live) = resolve_sqlite_path(app, LIVE_DB_URL) {
        reconcile_interrupted_restore(&live);
    }
}

/// Whether a file may be at `p` (v1.8.0 H2, code review): only NotFound
/// proves the name free. Any other lstat error (a permission, an I/O error)
/// leaves a file possibly there, so a read that guards data, a `-wal`
/// set-aside, takes it as present. Removal targets keep the plain
/// `name_lookup(p).is_ok()`: reading one as absent only leaves it in place.
fn may_exist(p: &Path) -> bool {
    !matches!(name_lookup(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
}

/// `symlink_metadata` reduced to its answer. Under test `LOOKUP_FAILS` can
/// make it fail for a chosen name.
fn name_lookup(p: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if LOOKUP_FAILS.with(|hook| hook.borrow().is_some_and(|fails| fails(p))) {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: this name cannot be looked at"));
    }
    std::fs::symlink_metadata(p).map(|_| ())
}

/// Where step 2 of `replace_database_file` sets an old sidecar aside.
fn set_aside_path(sidecar: &Path) -> PathBuf {
    PathBuf::from(format!("{}.restore-old", sidecar.to_string_lossy()))
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
        .ok_or_else(|| format!("resolve_sqlite_path: '{db}' is not a sqlite: URL"))?;
    let mut base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve_sqlite_path: could not resolve app config dir: {e}"))?;
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
/// The command resolves the live file path the plugin uses and hands both
/// paths to `restore_checked`, which re-validates `source` (defence in
/// depth) and, only if valid, replaces the live database file, setting its
/// WAL sidecars aside until the swap has succeeded (CR-U-15). On success the
/// JS side reloads the webview to re-init on the restored database. Returns
/// an error (and leaves the live DB untouched) if validation fails, or while
/// another connection has the live file open (v1.8.0 H2).
#[tauri::command]
pub async fn db_restore(app: tauri::AppHandle, db: String, source: String) -> Result<(), String> {
    let live_path = resolve_sqlite_path(&app, &db)?;
    restore_checked(Path::new(&source), &live_path).await
}

/// The testable core of `db_restore` (v1.7.2, L37): everything the command
/// does once the live path is known, so both guards are pinned by
/// `cargo test` without an `AppHandle` (the house split, as
/// `sample_reset_guarded`).
async fn restore_checked(source: &Path, live: &Path) -> Result<(), String> {
    // 1. Re-validate BEFORE touching anything destructive (the UI validated
    //    too, but the file could have changed between pre-flight and confirm).
    let validation = validate_backup_file(source).await;
    if !validation.ok {
        return Err(validation
            .reason
            .unwrap_or_else(|| "The selected file is not a valid Cairn backup.".to_string()));
    }

    // 2. Never restore the live file onto itself.
    refuse_self_restore(source, live)?;

    // 3. Swap the file; the old sidecars are set aside and put back if the
    //    swap fails. The live pool was closed by the JS caller before this
    //    invoke (or was never loaded, on the boot-screen path).
    replace_database_file(source, live).await
}

/// The database URL the webview loads (`DB_URL`, src/lib/backup-restore.ts)
/// and every restore command resolves: the startup reconciliation resolves it
/// the same way (v1.8.0 H2). Pinned by `live_db_url_is_pinned` and across the
/// languages in tests/policy/ipc-parity.test.ts.
pub const LIVE_DB_URL: &str = "sqlite:finance.db";

/// Never restore the live file onto itself (the same file under another
/// name included).
fn refuse_self_restore(source: &Path, live: &Path) -> Result<(), String> {
    if let (Ok(a), Ok(b)) = (source.canonicalize(), live.canonicalize()) {
        if a == b {
            return Err("db_restore: the selected backup IS the live database.".to_string());
        }
    }
    Ok(())
}

/// Tauri command: `invoke('db_restore_check', { db, source })` (v1.8.0 H2,
/// chip v). The refusals `db_restore` can make from the files alone — the
/// chosen file IS the live file, or Cairn's own staging file, or a set-aside
/// `-wal` from an earlier restore is next to the data — run BEFORE the JS
/// caller closes the live pool, so a refusal leaves the session on its open
/// pool and needs no reload. Reads only; `db_restore` runs every one of them
/// again after the close.
#[tauri::command]
pub async fn db_restore_check(app: tauri::AppHandle, db: String, source: String) -> Result<(), String> {
    let live_path = resolve_sqlite_path(&app, &db)?;
    refuse_before_close(Path::new(&source), &live_path)
}

/// The testable core of `db_restore_check`.
fn refuse_before_close(source: &Path, live: &Path) -> Result<(), String> {
    refuse_self_restore(source, live)?;
    refuse_before_staging(source, live)
}

/// The ONE database URL `db_sample_reset` may touch (W4 D-S8). Mirrored in TS
/// as `EXPLORE_DB_URL` (src/lib/explore-mode.ts); pinned by
/// `sample_db_url_is_pinned` and cross-language in tests/policy/ipc-parity.test.ts.
pub const SAMPLE_DB_URL: &str = "sqlite:sample-explore.db";

/// Equality allowlist — it must be IMPOSSIBLE to aim this command at
/// finance.db. Free function so the refusal is unit-tested without an AppHandle.
fn ensure_sample_url(db: &str) -> Result<(), String> {
    if db == SAMPLE_DB_URL {
        Ok(())
    } else {
        Err(format!(
            "db_sample_reset: refusing to reset '{db}' — only '{SAMPLE_DB_URL}' can be wiped"
        ))
    }
}

/// Delete a sqlite main file + its `-wal`/`-shm` sidecars, tolerating absence
/// (idempotent: the boot wipe runs on every explore boot, file present or not).
fn remove_db_files(live: &Path) -> Result<(), String> {
    let mut targets = vec![live.to_path_buf()];
    targets.extend(sidecar_paths(live));
    for t in targets {
        match std::fs::remove_file(&t) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(format!(
                    "db_sample_reset: could not delete {}: {e}",
                    t.display()
                ))
            }
        }
    }
    Ok(())
}

/// W4 (D-S2/D-S8): wipe the throwaway sample DB. Drops the pool from
/// `DbInstances` first — the map lives in the Rust process and SURVIVES webview
/// reloads, so a prior explore session's pool would hold the file open (Windows
/// can't delete an open file) and a later `Database.load` must start from a
/// fresh connection. The plugin's own `close` command leaves the entry in the
/// map; removing it here fully forgets the URL. `DbPool::close` is pub(crate),
/// so the removed pool is closed via sqlx's public `Pool::close`.
#[tauri::command]
pub async fn db_sample_reset(app: tauri::AppHandle, db: String) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    sample_reset_guarded(&instances, &db, |d| resolve_sqlite_path(&app, d)).await
}

/// The whole body of `db_sample_reset`, minus the `AppHandle`. W4 review: the
/// command used to inline this, so the allowlist call and the pool-drop were
/// only reachable through a `#[tauri::command]` no test can invoke — both a
/// deleted `ensure_sample_url(&db)?` and a skipped `Pool::close()` compiled
/// and passed `cargo test`. The house split stands (no test constructs an
/// `AppHandle`); the wrapper is now genuinely thin, and everything it does is
/// pinned by `sample_reset_refuses_the_real_db_without_touching_the_filesystem`
/// and `sample_reset_forgets_and_closes_the_sample_pool`.
///
/// ORDER IS LOAD-BEARING: the allowlist runs FIRST — before the pool map is
/// touched and before any path is even resolved.
async fn sample_reset_guarded<F>(
    instances: &DbInstances,
    db: &str,
    resolve: F,
) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<PathBuf, String>,
{
    ensure_sample_url(db)?;
    let removed = {
        let mut map = instances.0.write().await;
        map.remove(db)
    }; // write-guard dropped here, before the close/delete awaits
    if let Some(DbPool::Sqlite(pool)) = removed {
        pool.close().await;
    }
    let live = resolve(db)?;
    remove_db_files(&live)
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

    // ---- v1.7.1 U3 (CR-U3-5: tests only) — what a pre-update copy rests on. ----

    /// Tables named `name` in the database at `path`, opened read-write in its
    /// own folder: a copy of a WAL-mode main file carries the WAL flag in its
    /// header, and nothing else is beside it.
    async fn count_tables_named(path: &Path, name: &str) -> i64 {
        let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open copy");
        let row = sqlx::query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(name)
            .fetch_one(&pool)
            .await
            .expect("count tables");
        let n: i64 = row.get("n");
        pool.close().await;
        n
    }

    /// The live database runs in WAL mode (src/db/tauri-adapter.ts), so the
    /// newest committed transactions can sit in `finance.db-wal`, not yet
    /// checkpointed into the main file. A pre-update copy (VACUUM INTO) must
    /// still contain them — a copy of the main file alone would drop them.
    #[tokio::test]
    async fn backup_to_includes_committed_but_uncheckpointed_wal_frames() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("live.db");
        let url = format!("sqlite://{}?mode=rwc", src.to_string_lossy());
        // ONE connection: the two PRAGMAs are per connection, and this same
        // connection writes the rows and takes the backup.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("connect pool");
        for sql in [
            "PRAGMA journal_mode = WAL",
            "PRAGMA wal_autocheckpoint = 0",
            "CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)",
            "CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)",
            "INSERT INTO accounts (name) VALUES ('Checking'), ('Brokerage'), ('Roth IRA')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }

        // Precondition: the committed rows are in the WAL only.
        let wal = dir.path().join("live.db-wal");
        assert!(
            std::fs::metadata(&wal).map(|m| m.len() > 0).unwrap_or(false),
            "the -wal holds the committed frames"
        );
        let main_only_dir = tempfile::tempdir().unwrap();
        let main_only = main_only_dir.path().join("main-only.db");
        std::fs::copy(&src, &main_only).unwrap();
        assert_eq!(
            count_tables_named(&main_only, "accounts").await,
            0,
            "the main file alone does not have the table yet"
        );

        let dest = dir.path().join("backup.db");
        backup_to(&pool, &dest).await.expect("backup");

        assert!(!dir.path().join("backup.db-wal").exists(), "the copy is one self-contained file");
        assert_eq!(count_rows(&dest, "accounts").await, 3, "the copy holds the uncheckpointed rows");
        pool.close().await;
    }

    /// A backup into a folder Cairn cannot write fails with the VACUUM INTO
    /// error and creates nothing there: the pre-update copy's fail-closed
    /// screen (CR-U-1) and its partial-file cleanup rest on both halves.
    #[cfg(unix)]
    #[tokio::test]
    async fn backup_to_leaves_no_file_when_dest_dir_is_unwritable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let pool = seeded_pool(&dir.path().join("live.db")).await;
        let locked = dir.path().join("backups");
        std::fs::create_dir(&locked).unwrap();
        let mut perms = std::fs::metadata(&locked).unwrap().permissions();
        perms.set_mode(0o500); // r-x------ : can traverse + list, cannot create
        std::fs::set_permissions(&locked, perms).unwrap();
        let dest = locked.join("cairn-pre-update-53-to-55-20260925-101500.db");

        let result = backup_to(&pool, &dest).await;

        // Restore the mode first, so the asserts can list the folder and the
        // TempDir can clean up.
        let mut perms = std::fs::metadata(&locked).unwrap().permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&locked, perms).unwrap();
        let err = result.expect_err("VACUUM INTO into a folder Cairn cannot write must fail");
        assert!(err.starts_with("db_backup: VACUUM INTO failed:"), "the failure names its step: {err}");
        assert!(!dest.exists(), "no partial copy is left behind");
        assert_eq!(std::fs::read_dir(&locked).unwrap().count(), 0, "nothing at all is created in the folder");
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

        replace_database_file(&backup, &live).await.expect("replace");

        // The live file now holds exactly the backup's content (v1.7.2: the
        // staged file is rebuilt through SQLite, so its header bookkeeping —
        // the schema cookie — differs from the backup's bytes)...
        assert_eq!(db_content(&live).await, db_content(&backup).await, "the live file holds the backup's content");
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
        replace_database_file(&backup, &live).await.expect("replace with no sidecars");
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

        let result = replace_database_file(&backup, &live).await;

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

        let result = replace_database_file(&backup, &live).await;

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

        replace_database_file(&backup, &live).await.expect("replace");
        assert!(
            !restore_tmp_path(&live).exists(),
            "the .restore-tmp staging file must be renamed away on success"
        );
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    /// CR-U-11 (U1-m2/m10): the JS pre-update sweep deletes a family copy only
    /// when its rejection is DEFINITIVE, and it reads these phrases to decide
    /// (src/lib/pre-update-copy.ts isDefinitivelyInvalidCopy). Pin them on real
    /// files so a reworded reason cannot silently turn a sweep into "keep
    /// forever" — or a transient failure into a deletion.
    #[tokio::test]
    async fn validate_reasons_carry_the_phrases_the_pre_update_sweep_reads() {
        const DEFINITIVE: [&str; 4] = [
            "The backup failed an integrity check",
            "no schema_migrations table",
            "file is not a database",
            "database disk image is malformed",
        ];
        let dir = tempfile::tempdir().unwrap();
        let reason = |v: BackupValidation| v.reason.expect("a rejection carries a reason");

        let junk = dir.path().join("junk.db");
        std::fs::write(&junk, vec![b'x'; 200]).unwrap();
        assert!(reason(validate_backup_file(&junk).await).contains("file is not a database"));

        let empty = dir.path().join("empty.db");
        std::fs::write(&empty, b"").unwrap();
        assert!(reason(validate_backup_file(&empty).await).contains("no schema_migrations table"));

        // A VACUUM INTO copy cut short mid-write: the crashed-copy leftover.
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        let full = dir.path().join("full.db");
        backup_to(&pool, &full).await.unwrap();
        pool.close().await;
        let bytes = std::fs::read(&full).unwrap();
        let cut = dir.path().join("cut.db");
        std::fs::write(&cut, &bytes[..4096]).unwrap();
        assert!(reason(validate_backup_file(&cut).await).contains("database disk image is malformed"));

        // A garbled page: quick_check itself reports the problem.
        let mut garbled = bytes.clone();
        for b in garbled.iter_mut().skip(4096).take(2000) {
            *b = 0x5a;
        }
        let bad = dir.path().join("garbled.db");
        std::fs::write(&bad, &garbled).unwrap();
        assert!(reason(validate_backup_file(&bad).await).starts_with("The backup failed an integrity check"));

        // A file that cannot be opened says nothing about the file: none of
        // the definitive phrases, so the sweep keeps it.
        let missing = dir.path().join("missing.db");
        let r = reason(validate_backup_file(&missing).await);
        assert!(r.contains("unable to open database file"), "{r}");
        assert!(DEFINITIVE.iter().all(|p| !r.contains(p)), "{r}");
    }

    // ---- CR-U-15 (U1-m23/m32): the old sidecars are SET ASIDE, never deleted
    // before the swap, and put back if it fails. The rename seam lets a test
    // fail one chosen step on any platform. ----

    /// A live `finance.db` with KNOWN distinct bytes plus both sidecars, and a
    /// real backup elsewhere. Returns (dir, backup, live, wal, shm).
    async fn live_with_sidecars() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.db");
        let src = dir.path().join("seed.db");
        let pool = seeded_pool(&src).await;
        backup_to(&pool, &backup).await.unwrap();
        pool.close().await;
        let live = dir.path().join("finance.db");
        std::fs::write(&live, b"ORIGINAL-LIVE-DB").unwrap();
        let wal = dir.path().join("finance.db-wal");
        let shm = dir.path().join("finance.db-shm");
        std::fs::write(&wal, b"COMMITTED-WAL-FRAMES").unwrap();
        std::fs::write(&shm, b"SHM-INDEX").unwrap();
        (dir, backup, live, wal, shm)
    }

    fn aside(p: &Path) -> PathBuf {
        PathBuf::from(format!("{}.restore-old", p.to_string_lossy()))
    }

    fn assert_untouched(live: &Path, wal: &Path, shm: &Path) {
        assert_eq!(std::fs::read(live).unwrap(), b"ORIGINAL-LIVE-DB", "live must be byte-for-byte the original");
        assert_eq!(std::fs::read(wal).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal must be back, byte-for-byte");
        assert_eq!(std::fs::read(shm).unwrap(), b"SHM-INDEX", "the -shm must be back, byte-for-byte");
        assert!(!aside(wal).exists(), "no set-aside -wal left behind");
        assert!(!aside(shm).exists(), "no set-aside -shm left behind");
        assert!(!restore_tmp_path(live).exists(), "no staging file left behind");
    }

    #[tokio::test]
    async fn replace_database_file_rename_fails_after_the_sidecar_step_leaves_every_file_as_it_was() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let live_c = live.clone();
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("failed to finalize the restore"), "{msg}");
        assert!(msg.contains("your data is unchanged"), "every file is back, so the claim is true: {msg}");
        assert_untouched(&live, &wal, &shm);
    }

    #[tokio::test]
    async fn replace_database_file_success_removes_the_old_sidecars_and_their_set_aside_copies() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        replace_database_file(&backup, &live).await.expect("replace");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
        assert!(!wal.exists() && !shm.exists(), "the old sidecars are gone");
        assert!(!aside(&wal).exists() && !aside(&shm).exists(), "their set-aside copies are gone too");
        assert!(!restore_tmp_path(&live).exists());
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    #[tokio::test]
    async fn replace_database_file_set_aside_failure_puts_back_the_sidecar_already_moved() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let shm_aside = aside(&shm);
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == shm_aside.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the -shm is pinned"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("your data is unchanged"), "{msg}");
        assert_untouched(&live, &wal, &shm);
    }

    #[tokio::test]
    async fn replace_database_file_reports_truthfully_when_a_sidecar_cannot_be_put_back() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let live_c = live.clone();
        let wal_c = wal.clone();
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            if to == wal_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the -wal cannot go back"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(!msg.contains("your data is unchanged"), "never claim unchanged when a sidecar moved: {msg}");
        assert!(msg.contains("could not be put back"), "{msg}");
        assert!(msg.contains(&aside(&wal).display().to_string()), "the message names where the -wal is: {msg}");
        // The committed frames are KEPT at the set-aside path, never deleted.
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm went back");
        assert!(!restore_tmp_path(&live).exists());
    }

    #[tokio::test]
    async fn replace_database_file_refuses_when_an_earlier_restore_left_a_set_aside_sidecar() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::write(aside(&wal), b"EARLIER-SET-ASIDE-WAL").unwrap();
        let msg = replace_database_file(&backup, &live).await.unwrap_err();
        assert!(msg.contains("your data is unchanged"), "{msg}");
        assert!(msg.contains(&aside(&wal).display().to_string()), "{msg}");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"EARLIER-SET-ASIDE-WAL", "never overwritten");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX");
        assert!(!restore_tmp_path(&live).exists(), "refused before staging");
    }

    // ---- CR-U-20 (code-review round 2) ----

    /// (a) U1F-m1/m19: the step-0 refusal names the leftover and gives a calm
    /// next step; the refusal itself stays (it protects a set-aside WAL).
    #[tokio::test]
    async fn replace_database_file_refusal_names_the_leftover_and_the_next_step() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::write(aside(&wal), b"EARLIER").unwrap();
        let msg = replace_database_file(&backup, &live).await.unwrap_err();
        assert_eq!(
            msg,
            format!(
                "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
                aside(&wal).display()
            )
        );
        // CR-U-25: a leftover -shm set-aside never refuses; with both present
        // only the -wal is named (the singular form is the only form).
        std::fs::write(aside(&shm), b"EARLIER-SHM").unwrap();
        let msg = replace_database_file(&backup, &live).await.unwrap_err();
        assert_eq!(
            msg,
            format!(
                "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
                aside(&wal).display()
            )
        );
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"EARLIER", "the -wal leftover is kept");
    }

    /// CR-U-25: with no live -shm to set aside, a stale -shm set-aside is
    /// cleaned up rather than left behind forever.
    #[tokio::test]
    async fn replace_database_file_removes_a_stale_shm_set_aside() {
        let (_dir, backup, live, _wal, shm) = live_with_sidecars().await;
        std::fs::remove_file(&shm).unwrap();
        std::fs::write(aside(&shm), b"STALE-INDEX").unwrap();
        replace_database_file(&backup, &live).await.expect("a stale -shm set-aside never blocks");
        assert!(!aside(&shm).exists(), "the stale -shm set-aside is removed");
    }

    /// CR-U-25: a leftover -shm set-aside (the rebuildable index) never
    /// blocks a restore — after a stuck-shm failure the next restore succeeds.
    #[tokio::test]
    async fn replace_database_file_after_a_stuck_shm_failure_the_next_restore_succeeds() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let (live_c, shm_c) = (live.clone(), shm.clone());
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() || to == shm_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated"));
            }
            std::fs::rename(from, to)
        };
        let first = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(first.contains("The index file"), "{first}");
        assert!(aside(&shm).exists(), "the stuck -shm set-aside is still there");
        replace_database_file(&backup, &live).await.expect("the leftover -shm set-aside does not block the next restore");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
        assert!(!wal.exists() && !shm.exists());
        assert!(!aside(&wal).exists() && !aside(&shm).exists(), "no set-aside file is left behind");
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    /// (c) U1F-m3: the staged copy is flushed to disk BEFORE the atomic swap.
    #[tokio::test]
    async fn replace_database_file_syncs_the_staged_copy_before_the_swap() {
        let (_dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        let tmp = restore_tmp_path(&live);
        let events = std::cell::RefCell::new(Vec::<String>::new());
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            events.borrow_mut().push(format!("rename {} -> {}", from.display(), to.display()));
            std::fs::rename(from, to)
        };
        let mut sync = |p: &Path| -> std::io::Result<()> {
            events.borrow_mut().push(format!("sync {}", p.display()));
            real_sync(p)
        };
        replace_database_file_io(&backup, &live, &mut rename, &mut sync).await.expect("replace");
        let ev = events.borrow();
        let synced = ev.iter().position(|e| e == &format!("sync {}", tmp.display())).expect("the staged copy is synced");
        let swapped = ev
            .iter()
            .position(|e| e == &format!("rename {} -> {}", tmp.display(), live.display()))
            .expect("the swap ran");
        assert!(synced < swapped, "sync before the swap: {ev:?}");
        assert!(ev.iter().take(synced).all(|e| !e.starts_with("rename")), "sync before the sidecars move too: {ev:?}");
    }

    #[tokio::test]
    async fn replace_database_file_failed_sync_of_the_staged_copy_leaves_every_file_as_it_was() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let mut rename = |from: &Path, to: &Path| std::fs::rename(from, to);
        let mut sync = |_p: &Path| -> std::io::Result<()> {
            Err(std::io::Error::other("simulated: the flush failed"))
        };
        let msg = replace_database_file_io(&backup, &live, &mut rename, &mut sync).await.unwrap_err();
        assert!(msg.contains("failed to stage the backup (your data is unchanged)"), "{msg}");
        assert_untouched(&live, &wal, &shm);
    }

    /// (h) U1F-m9: a leftover `<live>.restore-tmp` picked as the source would
    /// be truncated by its own staging copy and an empty file swapped in.
    #[tokio::test]
    async fn replace_database_file_refuses_its_own_staging_file_as_the_source() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let tmp = restore_tmp_path(&live);
        std::fs::copy(&backup, &tmp).unwrap();
        let before = std::fs::read(&tmp).unwrap();
        let msg = replace_database_file(&tmp, &live).await.unwrap_err();
        assert_eq!(
            msg,
            "db_restore: the selected file is Cairn's own restore staging file, not a backup (your data is unchanged)"
        );
        assert_eq!(std::fs::read(&tmp).unwrap(), before, "the staging file is not truncated");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX");
    }

    /// (d) U1F-m6: with NO sidecars present (the usual Settings path, where
    /// pool.close() removed them) a failed swap is still "unchanged" — a
    /// missing sidecar is never treated as moved.
    #[tokio::test]
    async fn replace_database_file_failed_swap_with_no_sidecars_claims_unchanged_and_sets_nothing_aside() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::remove_file(&wal).unwrap();
        std::fs::remove_file(&shm).unwrap();
        let live_c = live.clone();
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("(your data is unchanged)"), "{msg}");
        assert!(!msg.contains("could not be put back"), "{msg}");
        assert!(!aside(&wal).exists() && !aside(&shm).exists());
        assert!(!wal.exists() && !shm.exists());
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
    }

    /// CR-U-23(c): the -shm is SQLite's rebuildable index — no data. A failed
    /// swap whose -shm cannot go back (while the -wal did) is NOT reported
    /// with the data-loss phrase the JS alarm keys on.
    #[tokio::test]
    async fn replace_database_file_a_stuck_shm_is_not_reported_as_data_loss() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let live_c = live.clone();
        let shm_c = shm.clone();
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            if to == shm_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the -shm cannot go back"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(!msg.contains("could not be put back"), "no data-loss alarm for the index: {msg}");
        assert!(msg.contains("(your data is unchanged)"), "{msg}");
        assert!(
            msg.contains(&format!("The index file {} is at {}", shm.display(), aside(&shm).display())),
            "{msg}"
        );
        assert!(msg.contains("SQLite rebuilds it from your data"), "{msg}");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal went back");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
    }

    /// CR-U-23(c): when BOTH are stuck, the -wal alarm stands (and names both).
    #[tokio::test]
    async fn replace_database_file_a_stuck_wal_alarms_even_when_the_shm_is_stuck_too() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let (live_c, wal_c, shm_c) = (live.clone(), wal.clone(), shm.clone());
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() || to == wal_c.as_path() || to == shm_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated"));
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("could not be put back"), "{msg}");
        assert!(!msg.contains("your data is unchanged"), "{msg}");
        assert!(msg.contains(&aside(&wal).display().to_string()) && msg.contains(&aside(&shm).display().to_string()), "{msg}");
    }

    // ---- CR-U-22 (code-review round 3): a read-only backup restores; the
    // production path really syncs. ----

    #[tokio::test]
    async fn replace_database_file_restores_from_a_read_only_backup() {
        let (_dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        let mut ro = std::fs::metadata(&backup).unwrap().permissions();
        ro.set_readonly(true); // mode 0444 on unix; the Read-only attribute on Windows
        std::fs::set_permissions(&backup, ro).unwrap();
        let backup_before = std::fs::read(&backup).unwrap();
        replace_database_file(&backup, &live).await.expect("a read-only backup restores");
        // NIT (b): the BACKUP itself is untouched — still read-only, same bytes.
        assert!(std::fs::metadata(&backup).unwrap().permissions().readonly(), "the backup keeps its read-only mode");
        assert_eq!(std::fs::read(&backup).unwrap(), backup_before, "the backup's bytes are untouched");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
        assert!(!std::fs::metadata(&live).unwrap().permissions().readonly(), "the restored finance.db is writable");
        assert!(!restore_tmp_path(&live).exists());
        assert_eq!(count_rows(&live, "accounts").await, 2);
        let mut rw = std::fs::metadata(&backup).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        rw.set_readonly(false);
        std::fs::set_permissions(&backup, rw).unwrap();
    }

    #[tokio::test]
    async fn replace_database_file_production_path_syncs_the_staged_copy() {
        let (_dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        SYNCED.with(|s| s.borrow_mut().clear());
        replace_database_file(&backup, &live).await.expect("replace");
        let synced = SYNCED.with(|s| s.borrow().clone());
        assert_eq!(synced, vec![restore_tmp_path(&live)], "the public entry point flushes the staged copy");
    }

    #[test]
    fn real_sync_reports_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        assert!(real_sync(&dir.path().join("does-not-exist.db")).is_err());
    }

    // ---- v1.7.2 L37: db_restore's core, driven without an AppHandle. ----

    #[tokio::test]
    async fn restore_checked_refuses_an_invalid_source_with_its_own_reason_and_touches_nothing() {
        let (dir, _backup, live, wal, shm) = live_with_sidecars().await;
        let junk = dir.path().join("junk.db");
        std::fs::write(&junk, vec![b'x'; 200]).unwrap();
        let reason = validate_backup_file(&junk).await.reason.expect("junk is refused");
        let err = restore_checked(&junk, &live).await.unwrap_err();
        assert_eq!(err, reason, "the validator's reason, as it is");
        assert_untouched(&live, &wal, &shm);
    }

    #[tokio::test]
    async fn restore_checked_refuses_the_live_file_itself() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("finance.db");
        seeded_pool(&live).await.close().await;
        let before = std::fs::read(&live).unwrap();
        let err = restore_checked(&live, &live).await.unwrap_err();
        assert_eq!(err, "db_restore: the selected backup IS the live database.");
        #[cfg(unix)]
        {
            // The same file under another name is the same file.
            let alias = dir.path().join("alias.db");
            std::os::unix::fs::symlink(&live, &alias).unwrap();
            let err = restore_checked(&alias, &live).await.unwrap_err();
            assert_eq!(err, "db_restore: the selected backup IS the live database.");
        }
        assert_eq!(std::fs::read(&live).unwrap(), before, "the live file is byte-for-byte the same");
        assert!(!restore_tmp_path(&live).exists(), "refused before staging");
    }

    #[tokio::test]
    async fn restore_checked_restores_a_valid_backup() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        restore_checked(&backup, &live).await.expect("a valid backup restores");
        assert_eq!(count_rows(&live, "accounts").await, 2);
        assert!(!wal.exists() && !shm.exists(), "the replaced file's sidecars went with it");
        assert!(!restore_tmp_path(&live).exists());
    }

    // ---- v1.7.2 L8: the file named is the file checked and restored. ----

    /// A valid backup named `name` in a fresh folder.
    async fn backup_named(name: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let pool = seeded_pool(&dir.path().join("seed.db")).await;
        let path = dir.path().join(name);
        backup_to(&pool, &path).await.unwrap();
        pool.close().await;
        (dir, path)
    }

    #[tokio::test]
    async fn validate_reads_a_name_with_a_percent_escape_as_written() {
        // No "Cairn backup.db" beside it: the '%20' is part of the name.
        let (_dir, path) = backup_named("Cairn%20backup.db").await;
        let v = validate_backup_file(&path).await;
        assert!(v.ok, "{:?}", v.reason);
    }

    #[tokio::test]
    async fn validate_never_checks_the_percent_decoded_sibling_instead() {
        let (dir, _valid_sibling) = backup_named("cairn-old.db").await;
        let junk = dir.path().join("cairn%2Dold.db");
        std::fs::write(&junk, vec![b'x'; 200]).unwrap();
        let v = validate_backup_file(&junk).await;
        assert!(!v.ok, "the file named is junk, whatever sits beside it");
        assert!(v.reason.unwrap().contains("file is not a database"));
    }

    /// Unix only: '?' is not a legal file-name character on Windows.
    #[cfg(unix)]
    #[tokio::test]
    async fn validate_reads_a_name_with_a_question_mark_as_written() {
        let (_dir, path) = backup_named("backup?v=1.db").await;
        let v = validate_backup_file(&path).await;
        assert!(v.ok, "{:?}", v.reason);
    }

    #[tokio::test]
    async fn restore_checked_restores_the_file_named_whatever_its_name() {
        // The '%20' name runs everywhere; '?' is not a legal file-name
        // character on Windows, so that name runs on unix only.
        let mut names = vec!["Cairn%20backup.db"];
        if cfg!(unix) {
            names.push("backup?v=1.db");
        }
        for name in names {
            let (dir, backup, live, _wal, _shm) = live_with_sidecars().await;
            let named = dir.path().join(name);
            std::fs::copy(&backup, &named).unwrap();
            restore_checked(&named, &live).await.unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(count_rows(&live, "accounts").await, 2, "{name}");
        }
    }

    #[tokio::test]
    async fn restore_checked_refuses_junk_whose_decoded_name_is_a_valid_backup() {
        let (dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::copy(&backup, dir.path().join("cairn-old.db")).unwrap();
        let junk = dir.path().join("cairn%2Dold.db");
        std::fs::write(&junk, vec![b'x'; 200]).unwrap();
        let err = restore_checked(&junk, &live).await.unwrap_err();
        assert!(err.contains("file is not a database"), "{err}");
        assert_untouched(&live, &wal, &shm);
    }

    // ---- v1.7.2 L1 (CR-172-1/4): what was validated is what is restored. ----

    /// Every schema object's SQL, every row of every table (SQL-quoted), and
    /// `user_version`: what "holds the backup's content" means once the
    /// staged file is rebuilt through SQLite (its header bookkeeping — the
    /// schema cookie — differs from the source's bytes by design).
    async fn db_content(path: &Path) -> Vec<String> {
        let url = format!("sqlite://{}?mode=ro", path.to_string_lossy());
        let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await.expect("open");
        let uv: i64 = sqlx::query("PRAGMA user_version").fetch_one(&pool).await.unwrap().get(0);
        let mut out = vec![format!("user_version {uv}")];
        let objects = sqlx::query("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
            .fetch_all(&pool)
            .await
            .unwrap();
        for o in &objects {
            let (ty, name, sql): (String, String, Option<String>) = (o.get(0), o.get(1), o.get(2));
            out.push(format!("{ty} {name}: {}", sql.unwrap_or_default()));
            if ty == "table" {
                let cols: Vec<String> = sqlx::query(&format!("SELECT name FROM pragma_table_info('{name}')"))
                    .fetch_all(&pool)
                    .await
                    .unwrap()
                    .iter()
                    .map(|c| format!("quote(\"{}\")", c.get::<String, _>(0)))
                    .collect();
                let rows = sqlx::query(&format!("SELECT {} FROM \"{name}\" ORDER BY rowid", cols.join(" || '|' || ")))
                    .fetch_all(&pool)
                    .await
                    .unwrap();
                out.extend(rows.iter().map(|r| format!("{name}: {}", r.get::<String, _>(0))));
            }
        }
        pool.close().await;
        out
    }

    /// A raw copy of a WAL-mode data folder taken while Cairn had it open
    /// (Finder, Time Machine): `finance.db` + `-wal` + `-shm`, copied with the
    /// writer still connected. With `checkpoint_first`, two accounts are in
    /// the main file; three more (all five without it, plus every table) are
    /// committed in the copied `-wal` only.
    async fn raw_copy_of_an_open_wal_database(dir: &Path, checkpoint_first: bool) -> PathBuf {
        let orig = dir.join("open");
        std::fs::create_dir(&orig).unwrap();
        let open = orig.join("finance.db");
        let url = format!("sqlite://{}?mode=rwc", open.to_string_lossy());
        // ONE connection: the PRAGMAs are per connection.
        let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        for sql in [
            "PRAGMA journal_mode = WAL",
            "PRAGMA wal_autocheckpoint = 0",
            "CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)",
            "INSERT INTO schema_migrations (version) VALUES ('0001_initial')",
            "CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)",
            "INSERT INTO accounts (name) VALUES ('Checking'), ('Brokerage')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        sqlx::query(&format!("PRAGMA user_version = {MAX_SCHEMA_VERSION}")).execute(&pool).await.unwrap();
        if checkpoint_first {
            sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO accounts (name) VALUES ('Roth IRA'), ('HSA'), ('529')").execute(&pool).await.unwrap();
        let copied = dir.join("copied");
        std::fs::create_dir(&copied).unwrap();
        for suffix in ["", "-wal", "-shm"] {
            let from = PathBuf::from(format!("{}{suffix}", open.display()));
            std::fs::copy(&from, PathBuf::from(format!("{}{suffix}", copied.join("finance.db").display()))).unwrap();
        }
        pool.close().await;
        copied.join("finance.db")
    }

    #[tokio::test]
    async fn restore_of_a_partly_checkpointed_wal_source_restores_the_rows_it_validated() {
        let dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        // Precondition: the main file alone is older — the -wal holds 3 rows.
        let main_only = dir.path().join("main-only.db");
        std::fs::copy(&src, &main_only).unwrap();
        assert_eq!(count_rows(&main_only, "accounts").await, 2, "the main file alone has 2 accounts");
        let validated = validate_backup_file(&src).await;
        assert!(validated.ok, "{:?}", validated.reason);
        let validated_rows = count_rows(&src, "accounts").await;
        assert_eq!(validated_rows, 5, "what the validator reads: main file + -wal");

        let (_live_dir, _backup, live, _wal, _shm) = live_with_sidecars().await;
        restore_checked(&src, &live).await.expect("restore");
        assert_eq!(count_rows(&live, "accounts").await, validated_rows, "rows validated == rows restored");
    }

    #[tokio::test]
    async fn restore_of_a_never_checkpointed_wal_source_is_not_an_empty_database() {
        let dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(dir.path(), false).await;
        let main_only = dir.path().join("main-only.db");
        std::fs::copy(&src, &main_only).unwrap();
        assert_eq!(count_tables_named(&main_only, "accounts").await, 0, "the main file alone has no tables yet");

        let (_live_dir, _backup, live, _wal, _shm) = live_with_sidecars().await;
        restore_checked(&src, &live).await.expect("restore");
        assert_eq!(db_content(&live).await, db_content(&src).await, "every table, row and the schema version");
        assert_eq!(count_rows(&live, "accounts").await, 5);
    }

    #[tokio::test]
    async fn the_restored_file_is_one_self_contained_rollback_mode_file() {
        let dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(dir.path(), false).await;
        let (_live_dir, _backup, live, wal, shm) = live_with_sidecars().await;
        restore_checked(&src, &live).await.expect("restore");
        // Read the header before any connection opens the restored file.
        let header = std::fs::read(&live).unwrap();
        assert_eq!(&header[..16], b"SQLite format 3\0");
        assert_eq!((header[18], header[19]), (1, 1), "rollback mode: the file alone is the whole database");
        assert!(!wal.exists() && !shm.exists(), "no -wal or -shm beside the restored file");
        for suffix in ["-wal", "-shm", "-journal"] {
            let beside_tmp = PathBuf::from(format!("{}{suffix}", restore_tmp_path(&live).display()));
            assert!(!beside_tmp.exists(), "nothing left beside the staging file: {suffix}");
        }
    }

    #[tokio::test]
    async fn restore_leaves_the_source_files_byte_identical() {
        let dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        // The Settings pre-flight (DataSection doRestore) validates first; a
        // reader writes its lock slots into an existing -shm index there.
        assert!(validate_backup_file(&src).await.ok);
        let files = |p: &Path| ["", "-wal", "-shm"].map(|suffix| std::fs::read(format!("{}{suffix}", p.display())).ok());
        let before = files(&src);

        let (_live_dir, _backup, live, _wal, _shm) = live_with_sidecars().await;
        restore_checked(&src, &live).await.expect("restore");
        assert_eq!(files(&src), before, "the source's main file, -wal and -shm are byte-identical");
        let mut listed: Vec<String> = std::fs::read_dir(src.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        listed.sort();
        assert_eq!(listed, ["finance.db", "finance.db-shm", "finance.db-wal"], "nothing added beside the source");
    }

    /// CR-U-22 stays load-bearing now that SQLite creates the staged file
    /// fresh (only an unusual umask would make it read-only): pinned on the
    /// swap half directly, with a read-only staged copy.
    #[tokio::test]
    async fn swap_staged_makes_a_read_only_staged_copy_writable_before_its_flush() {
        let (_dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        let tmp = restore_tmp_path(&live);
        std::fs::copy(&backup, &tmp).unwrap();
        let mut ro = std::fs::metadata(&tmp).unwrap().permissions();
        ro.set_readonly(true);
        std::fs::set_permissions(&tmp, ro).unwrap();
        swap_staged(&live, &mut |from: &Path, to: &Path| std::fs::rename(from, to), &mut |p: &Path| real_sync(p))
            .expect("a read-only staged copy is made writable, flushed and swapped in");
        assert!(!std::fs::metadata(&live).unwrap().permissions().readonly(), "the restored finance.db is writable");
        assert_eq!(count_rows(&live, "accounts").await, 2);
    }

    /// Cairn's own backups are rollback-mode files, so reading one needs no
    /// file beside it: a backup in a folder Cairn cannot write (a read-only
    /// volume, a locked folder) restores as it did with `fs::copy`.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_backup_in_a_folder_cairn_cannot_write_still_restores() {
        use std::os::unix::fs::PermissionsExt;

        let (dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        let locked = dir.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        let inside = locked.join("backup.db");
        std::fs::copy(&backup, &inside).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = restore_checked(&inside, &live).await;

        let listed = std::fs::read_dir(&locked).unwrap().count();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        result.expect("a backup in a read-only folder restores");
        assert_eq!(listed, 1, "nothing was created beside the backup");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
    }

    /// The Time Machine / read-only-volume shape (v1.7.2 plan review): a raw
    /// copy of an open WAL database, `-shm` included, read-only files in a
    /// folder Cairn cannot write. SQLite reads a read-only `-shm` from its own
    /// memory and still replays the `-wal`, so every committed row is
    /// restored, and the staging adds nothing beside the source.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_raw_wal_copy_in_a_folder_cairn_cannot_write_restores_every_row() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        let folder = src.parent().unwrap().to_path_buf();
        for suffix in ["", "-wal", "-shm"] {
            let file = format!("{}{suffix}", src.display());
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o444)).unwrap();
        }
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).unwrap();

        let (_live_dir, _backup, live, _wal, _shm) = live_with_sidecars().await;
        let result = restore_checked(&src, &live).await;
        let mut listed: Vec<String> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        listed.sort();

        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        result.expect("a raw WAL copy in a read-only folder restores");
        assert_eq!(listed, ["finance.db", "finance.db-shm", "finance.db-wal"], "nothing added beside the source");
        assert_eq!(count_rows(&live, "accounts").await, 5, "every committed row, the -wal's included");
    }

    #[tokio::test]
    async fn a_staging_file_left_by_an_interrupted_restore_does_not_block_the_next_one() {
        let (_dir, backup, live, _wal, _shm) = live_with_sidecars().await;
        std::fs::write(restore_tmp_path(&live), b"LEFT BY AN INTERRUPTED RESTORE").unwrap();
        replace_database_file(&backup, &live).await.expect("restores over the leftover");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
        assert!(!restore_tmp_path(&live).exists());
    }

    // ---- v1.7.2 (CR-172-1/4): the STAGED file is validated before the swap. ----

    /// What an unfaithful staging copy would leave: an empty file.
    fn empty_the_staged_file(p: &Path) {
        std::fs::write(p, b"").unwrap();
    }

    #[tokio::test]
    async fn a_staged_file_that_fails_validation_is_never_swapped_in() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        AFTER_STAGE.with(|hook| *hook.borrow_mut() = Some(empty_the_staged_file));
        let result = replace_database_file(&backup, &live).await;
        AFTER_STAGE.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(
            result.unwrap_err(),
            "db_restore: failed to stage the backup (your data is unchanged): This does not look like a Cairn backup (no schema_migrations table)."
        );
        assert_untouched(&live, &wal, &shm);
    }

    #[tokio::test]
    async fn the_staged_check_refuses_a_newer_schema_file_and_touches_nothing() {
        let (dir, _backup, live, wal, shm) = live_with_sidecars().await;
        let newer = dir.path().join("newer.db");
        let pool = seeded_pool(&newer).await;
        sqlx::query(&format!("PRAGMA user_version = {}", MAX_SCHEMA_VERSION + 5)).execute(&pool).await.unwrap();
        pool.close().await;
        // replace_database_file itself: no source validation runs before it.
        let err = replace_database_file(&newer, &live).await.unwrap_err();
        let prefix = format!(
            "db_restore: failed to stage the backup (your data is unchanged): This backup was created by a newer version of Cairn (schema {};",
            MAX_SCHEMA_VERSION + 5
        );
        assert!(err.starts_with(&prefix), "{err}");
        assert_untouched(&live, &wal, &shm);
    }

    #[tokio::test]
    async fn the_staged_check_refuses_a_file_without_schema_migrations_and_touches_nothing() {
        let (dir, _backup, live, wal, shm) = live_with_sidecars().await;
        let other = dir.path().join("other.db");
        let url = format!("sqlite://{}?mode=rwc", other.to_string_lossy());
        let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        sqlx::query("CREATE TABLE foo (id INTEGER PRIMARY KEY)").execute(&pool).await.unwrap();
        pool.close().await;
        let err = replace_database_file(&other, &live).await.unwrap_err();
        assert_eq!(
            err,
            "db_restore: failed to stage the backup (your data is unchanged): This does not look like a Cairn backup (no schema_migrations table)."
        );
        assert_untouched(&live, &wal, &shm);
    }

    /// A source whose pages go bad past its header: it opens, VACUUM INTO
    /// creates the staging file, then the copy fails partway. The partial
    /// staging file is removed and nothing of the live data moves.
    #[tokio::test]
    async fn a_staging_copy_that_fails_partway_is_removed_and_touches_nothing() {
        let (dir, _backup, live, wal, shm) = live_with_sidecars().await;
        let pool = seeded_pool(&dir.path().join("large-seed.db")).await;
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000) \
             INSERT INTO accounts (name) SELECT printf('Account %04d, a name long enough to fill pages', i) FROM n",
        )
        .execute(&pool)
        .await
        .unwrap();
        let bad = dir.path().join("bad.db");
        backup_to(&pool, &bad).await.unwrap();
        pool.close().await;
        // The header and the schema page stay; the middle half becomes 0x5a.
        let mut bytes = std::fs::read(&bad).unwrap();
        let len = bytes.len();
        bytes[len / 4..3 * len / 4].fill(0x5a);
        std::fs::write(&bad, &bytes).unwrap();

        let err = replace_database_file(&bad, &live).await.unwrap_err();
        assert!(err.contains("(your data is unchanged)"), "{err}");
        assert!(!restore_tmp_path(&live).exists(), "the partial staging file is removed: {err}");
        assert_untouched(&live, &wal, &shm);
    }

    // ---- v1.8.0 H2 (chip v171-2): restore-swap hardening. ----

    /// v1.7.2 chip e: the validator closes its connection on EVERY exit, a
    /// refusal included. A connection that is only dropped is closed later on
    /// sqlx's worker thread; on Windows SQLite's open handle (no
    /// FILE_SHARE_DELETE) can then refuse the removal of a staged file the
    /// check just refused (that half runs on v171-1's Windows cargo job).
    #[tokio::test]
    async fn the_validator_closes_its_connection_on_every_exit() {
        let dir = tempfile::tempdir().unwrap();
        let pool = seeded_pool(&dir.path().join("seed.db")).await;
        let good = dir.path().join("good.db");
        backup_to(&pool, &good).await.unwrap();
        sqlx::query(&format!("PRAGMA user_version = {}", MAX_SCHEMA_VERSION + 5)).execute(&pool).await.unwrap();
        let newer = dir.path().join("newer.db");
        backup_to(&pool, &newer).await.unwrap();
        pool.close().await;
        let junk = dir.path().join("junk.db"); // quick_check cannot run
        std::fs::write(&junk, vec![b'x'; 200]).unwrap();
        let empty = dir.path().join("empty.db"); // no schema_migrations table
        std::fs::write(&empty, b"").unwrap();
        let mut garbled = std::fs::read(&good).unwrap(); // quick_check reports a problem
        for b in garbled.iter_mut().skip(4096).take(2000) {
            *b = 0x5a;
        }
        let bad = dir.path().join("garbled.db");
        std::fs::write(&bad, &garbled).unwrap();

        for (path, ok) in [(&good, true), (&junk, false), (&empty, false), (&bad, false), (&newer, false)] {
            let before = VALIDATOR_CLOSES.with(|n| n.get());
            let v = validate_backup_file(path).await;
            assert_eq!(v.ok, ok, "{}: {:?}", path.display(), v.reason);
            assert_eq!(
                VALIDATOR_CLOSES.with(|n| n.get()),
                before + 1,
                "{}: the connection is closed before the verdict returns ({:?})",
                path.display(),
                v.reason
            );
        }
    }

    /// Chip t (U1F-m7): a sidecar that appears while the old one is set
    /// aside (another connection's fresh -wal) is never replaced by the
    /// put-back: rename(2) replaces its destination, so v1.7.2 overwrote it
    /// and still said "(your data is unchanged)". Now the -wal that cannot
    /// go back is reported as stuck, and both files are kept.
    #[tokio::test]
    async fn a_put_back_never_replaces_a_sidecar_created_meanwhile() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let (live_c, wal_c) = (live.clone(), wal.clone());
        let mut production = swap_move(&live);
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                std::fs::write(&wal_c, b"A-NEWER-WAL").unwrap(); // another connection, meanwhile
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            production(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("could not be put back"), "{msg}");
        assert!(!msg.contains("your data is unchanged"), "{msg}");
        assert!(msg.contains(&aside(&wal).display().to_string()), "the message names where the -wal is: {msg}");
        assert_eq!(std::fs::read(&wal).unwrap(), b"A-NEWER-WAL", "the newer -wal is never replaced");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the set-aside -wal is kept");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm went back");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
    }

    /// Chip v: the refusals db_restore can make from the files alone also run
    /// BEFORE the JS caller closes the live pool (db_restore_check), so a
    /// refusal leaves the session on its open pool, with no reload. Each is
    /// the message db_restore gives, and the check touches nothing.
    #[tokio::test]
    async fn the_check_before_the_close_refuses_what_db_restore_would_and_touches_nothing() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        assert_eq!(refuse_before_close(&backup, &live), Ok(()));
        assert_eq!(
            refuse_before_close(&live, &live),
            Err("db_restore: the selected backup IS the live database.".to_string())
        );
        let tmp = restore_tmp_path(&live);
        std::fs::copy(&backup, &tmp).unwrap();
        assert_eq!(
            refuse_before_close(&tmp, &live),
            Err("db_restore: the selected file is Cairn's own restore staging file, not a backup (your data is unchanged)".to_string())
        );
        std::fs::remove_file(&tmp).unwrap();
        std::fs::write(aside(&shm), b"OLD-INDEX").unwrap();
        assert_eq!(refuse_before_close(&backup, &live), Ok(()), "a -shm set-aside never refuses");
        assert_eq!(std::fs::read(aside(&shm)).unwrap(), b"OLD-INDEX", "the check leaves it for db_restore to remove");
        std::fs::write(aside(&wal), b"EARLIER").unwrap();
        assert_eq!(
            refuse_before_close(&backup, &live),
            Err(format!(
                "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
                aside(&wal).display()
            ))
        );
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"EARLIER");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX");
        assert!(!tmp.exists());
    }

    /// A WAL-mode `finance.db` that another connection has open and has read
    /// from (so it holds its lock), as a second Cairn window would.
    async fn live_held_by_another_connection(dir: &Path) -> (PathBuf, Pool<Sqlite>) {
        let live = dir.join("finance.db");
        let other = seeded_pool(&live).await;
        sqlx::query("PRAGMA journal_mode = WAL").execute(&other).await.unwrap();
        sqlx::query("SELECT COUNT(*) FROM accounts").fetch_one(&other).await.unwrap();
        (live, other)
    }

    fn data_files(live: &Path) -> [Option<Vec<u8>>; 3] {
        ["", "-wal", "-shm"].map(|suffix| std::fs::read(format!("{}{suffix}", live.display())).ok())
    }

    const OPEN_ELSEWHERE_REFUSAL: &str =
        "db_restore: another Cairn window or another program has your data open. Close it, then restore again (your data is unchanged)";

    /// Chip p (U1-m5/m7/m35, U4 chip f): while another connection has the
    /// live file open — a second Cairn window, or another program — the
    /// restore refuses before anything moves. Renaming over a file another
    /// process holds would leave that process writing to a file that is no
    /// longer in the folder.
    #[tokio::test]
    async fn a_restore_refuses_while_another_connection_has_the_data_open() {
        let dir = tempfile::tempdir().unwrap();
        let (live, other) = live_held_by_another_connection(dir.path()).await;
        let seed = seeded_pool(&dir.path().join("seed.db")).await;
        sqlx::query("INSERT INTO accounts (name) VALUES ('Only in the backup')").execute(&seed).await.unwrap();
        let backup = dir.path().join("backup.db");
        backup_to(&seed, &backup).await.unwrap();
        seed.close().await;
        let before = data_files(&live);
        assert!(before[1].is_some() && before[2].is_some(), "the other connection keeps a -wal and a -shm");

        let started = std::time::Instant::now();
        let err = replace_database_file(&backup, &live).await.unwrap_err();
        assert_eq!(err, OPEN_ELSEWHERE_REFUSAL);
        assert!(started.elapsed() < std::time::Duration::from_secs(3), "refused at once, not after a busy wait");
        assert_eq!(data_files(&live), before, "finance.db, its -wal and its -shm are byte-identical");
        assert!(!restore_tmp_path(&live).exists(), "the staged copy is removed");
        assert!(!aside(&dir.path().join("finance.db-wal")).exists() && !aside(&dir.path().join("finance.db-shm")).exists());
        let n: i64 = sqlx::query("SELECT COUNT(*) FROM accounts").fetch_one(&other).await.unwrap().get(0);
        assert_eq!(n, 2, "the other connection still reads its data");

        other.close().await;
        replace_database_file(&backup, &live).await.expect("restores once nothing else has the file open");
        assert_eq!(count_rows(&live, "accounts").await, 3);
    }

    /// The check refuses only when SQLite reports the file locked: a file
    /// that is missing, not a database, or that nothing else holds says
    /// nothing about other connections, and the restore goes ahead as
    /// before. None of them is changed by the check.
    #[tokio::test]
    async fn the_exclusivity_check_refuses_only_a_file_another_connection_holds() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(refuse_if_open_elsewhere(&dir.path().join("missing.db")).await, Ok(()));
        assert!(!dir.path().join("missing.db").exists(), "nothing is created");
        let junk = dir.path().join("junk.db");
        std::fs::write(&junk, b"ORIGINAL-LIVE-DB").unwrap();
        assert_eq!(refuse_if_open_elsewhere(&junk).await, Ok(()));
        assert_eq!(std::fs::read(&junk).unwrap(), b"ORIGINAL-LIVE-DB");
        let pool = seeded_pool(&dir.path().join("seed.db")).await;
        let alone = dir.path().join("alone.db");
        backup_to(&pool, &alone).await.unwrap();
        pool.close().await;
        let bytes = std::fs::read(&alone).unwrap();
        assert_eq!(refuse_if_open_elsewhere(&alone).await, Ok(()));
        assert_eq!(std::fs::read(&alone).unwrap(), bytes);
        let held = tempfile::tempdir().unwrap();
        let (live, other) = live_held_by_another_connection(held.path()).await;
        assert_eq!(refuse_if_open_elsewhere(&live).await, Err(OPEN_ELSEWHERE_REFUSAL.to_string()));
        other.close().await;
        assert_eq!(refuse_if_open_elsewhere(&live).await, Ok(()));

        // Nothing else holds a file whose committed rows are all in its -wal
        // (a startup-failure screen, where no pool was loaded): the check's
        // close moves them into the file itself. Every row is still there.
        let wal_dir = tempfile::tempdir().unwrap();
        let src = raw_copy_of_an_open_wal_database(wal_dir.path(), false).await;
        let content = db_content(&src).await;
        assert_eq!(refuse_if_open_elsewhere(&src).await, Ok(()));
        assert!(!PathBuf::from(format!("{}-wal", src.display())).exists(), "the -wal was checkpointed into the file");
        assert_eq!(db_content(&src).await, content, "the same tables, rows and schema version");
    }

    /// The names in a folder, sorted.
    fn names_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    /// A live finance.db whose newest rows are only in its -wal (no pool
    /// loaded, as on a startup-failure screen), and a backup to restore.
    /// Returns (dir, backup, live, the folder live is in).
    async fn an_undrained_live_and_a_backup() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let live = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        let folder = live.parent().unwrap().to_path_buf();
        let seed = seeded_pool(&dir.path().join("seed.db")).await;
        let backup = dir.path().join("backup.db");
        backup_to(&seed, &backup).await.unwrap();
        seed.close().await;
        (dir, backup, live, folder)
    }

    /// This build's own crash point 1 (second-round review), in the
    /// production order: stage, the exclusivity check, then step 2. The
    /// check's close drains the -wal into finance.db, so step 2 sets aside
    /// only the -shm, and a kill before step 3 leaves finance.db whole on its
    /// own. The next launch removes the index set-aside and the staged copy.
    #[tokio::test]
    async fn an_interrupted_production_restore_between_steps_2_and_3_is_settled_at_the_next_launch() {
        let (_dir, backup, live, folder) = an_undrained_live_and_a_backup().await;
        let content = db_content(&live).await;

        stage_restore(&backup, &live).await.expect("staged");
        assert_eq!(refuse_if_open_elsewhere(&live).await, Ok(()));
        crash_before_the_swap(&live);
        assert_eq!(
            names_in(&folder),
            ["finance.db", "finance.db-shm.restore-old", "finance.db.restore-tmp"],
            "the check drained the -wal, so only the -shm was set aside"
        );

        reconcile_interrupted_restore(&live);
        assert_eq!(names_in(&folder), ["finance.db"]);
        assert_eq!(db_content(&live).await, content, "finance.db alone holds every row");
    }

    /// This build's own crash point 2 (second-round review), in the same
    /// order: a kill right after step 3. The restored file is in place with
    /// only the -shm set-aside beside it, which the next launch removes.
    #[tokio::test]
    async fn an_interrupted_production_restore_between_steps_3_and_4_is_finished_at_the_next_launch() {
        let (_dir, backup, live, folder) = an_undrained_live_and_a_backup().await;

        stage_restore(&backup, &live).await.expect("staged");
        assert_eq!(refuse_if_open_elsewhere(&live).await, Ok(()));
        crash_right_after_the_swap(&live);
        assert_eq!(
            names_in(&folder),
            ["finance.db", "finance.db-shm.restore-old"],
            "the check drained the -wal, so only the -shm was set aside"
        );

        reconcile_interrupted_restore(&live);
        assert_eq!(names_in(&folder), ["finance.db"]);
        assert_eq!(db_content(&live).await, db_content(&backup).await, "the restored file, untouched");
    }

    /// A simulated crash: the process stops inside a move, so nothing after
    /// it runs (no put-back, no clean-up). `swap_staged` is synchronous, so
    /// the stop is caught right here and the files are left as a kill would
    /// leave them.
    fn crash_inside(swap: impl FnOnce() -> Result<(), String>) {
        let stopped = std::panic::catch_unwind(std::panic::AssertUnwindSafe(swap));
        assert!(stopped.is_err(), "the simulated crash stops the swap");
    }

    /// Chip r (U1F-m3): the staged copy is removed only AFTER the put-back
    /// has run. A crash during the put-back then leaves it beside the
    /// set-aside -wal, which tells the next launch that the swap never ran.
    #[tokio::test]
    async fn a_crash_during_a_put_back_leaves_the_staged_copy_for_the_next_launch() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        let (live_c, wal_c) = (live.clone(), wal.clone());
        crash_inside(|| {
            swap_staged(
                &live,
                &mut |from: &Path, to: &Path| -> std::io::Result<()> {
                    if to == live_c.as_path() {
                        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
                    }
                    if to == wal_c.as_path() {
                        panic!("simulated: the process stops during the put-back");
                    }
                    std::fs::rename(from, to)
                },
                &mut |p: &Path| real_sync(p),
            )
        });
        assert!(restore_tmp_path(&live).exists(), "the staged copy is still there");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal is still set aside");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm went back first");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
    }

    /// The same for a failure in step 2: the -shm cannot be set aside, and
    /// the process stops while the -wal goes back.
    #[tokio::test]
    async fn a_crash_during_a_step_2_put_back_leaves_the_staged_copy_too() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        let (wal_c, shm_aside) = (wal.clone(), aside(&shm));
        crash_inside(|| {
            swap_staged(
                &live,
                &mut |from: &Path, to: &Path| -> std::io::Result<()> {
                    if to == shm_aside.as_path() {
                        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the -shm is pinned"));
                    }
                    if to == wal_c.as_path() {
                        panic!("simulated: the process stops during the put-back");
                    }
                    std::fs::rename(from, to)
                },
                &mut |p: &Path| real_sync(p),
            )
        });
        assert!(restore_tmp_path(&live).exists(), "the staged copy is still there");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal is still set aside");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm never moved");
    }

    /// Crash point 1's state: step 2 set the sidecars aside and the process
    /// stopped before step 3.
    fn crash_before_the_swap(live: &Path) {
        let live_c = live.to_path_buf();
        crash_inside(|| {
            swap_staged(
                live,
                &mut |from: &Path, to: &Path| -> std::io::Result<()> {
                    if to == live_c.as_path() {
                        panic!("simulated: the process stops before the swap");
                    }
                    std::fs::rename(from, to)
                },
                &mut |p: &Path| real_sync(p),
            )
        });
    }

    /// Crash point 2's state: step 3 put the staged copy in place and the
    /// process stopped before step 4.
    fn crash_right_after_the_swap(live: &Path) {
        let live_c = live.to_path_buf();
        crash_inside(|| {
            swap_staged(
                live,
                &mut |from: &Path, to: &Path| -> std::io::Result<()> {
                    std::fs::rename(from, to)?;
                    if to == live_c.as_path() {
                        panic!("simulated: the process stops right after the swap");
                    }
                    Ok(())
                },
                &mut |p: &Path| real_sync(p),
            )
        });
    }

    /// Chip r (U1F-m3), crash point 1, as a build without the exclusivity
    /// check (or a -wal its drain could not empty) leaves it: both sidecars
    /// set aside and the staged copy beside them. Nothing on disk proves
    /// which finance.db a set-aside -wal belongs to (second-round review: a
    /// file put in place by hand passes every test of the files alone), so
    /// the launch keeps it, byte-for-byte, and the next restore names it
    /// (CR-U1-53). It removes the -shm set-aside (the rebuildable index,
    /// CR-U-25) and keeps the staged copy beside the kept -wal.
    #[tokio::test]
    async fn an_interrupted_restore_between_steps_2_and_3_keeps_its_wal_set_aside_for_the_next_restore() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);
        // The crash state: the staged copy and both set-aside sidecars, and
        // finance.db without its -wal beside it.
        assert!(restore_tmp_path(&live).exists() && aside(&wal).exists() && aside(&shm).exists());
        assert!(!wal.exists() && !shm.exists());

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal set-aside is kept, byte-for-byte");
        assert!(!wal.exists(), "never put back: nothing proves it belongs to this finance.db");
        assert!(!aside(&shm).exists() && !shm.exists(), "the index set-aside is removed, not put back");
        assert!(restore_tmp_path(&live).exists(), "the staged copy stays beside the kept -wal");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(
            stage_restore(&backup, &live).await.unwrap_err(),
            leftover_refusal(&aside(&wal)),
            "the next restore names the kept -wal"
        );
    }

    /// Crash point 2, the same build: step 3 put the restored copy in place
    /// and the process stopped before step 4. The -shm set-aside goes. The
    /// -wal set-aside is kept (second-round review: a rollback-mode
    /// finance.db does not prove that step 3 ran, because every Cairn backup
    /// is one, and SQLite replays a -wal found beside it). The restored file
    /// is left exactly as the swap put it, with nothing beside it.
    #[tokio::test]
    async fn an_interrupted_restore_between_steps_3_and_4_keeps_its_wal_set_aside_for_the_next_restore() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        crash_right_after_the_swap(&live);
        assert!(!restore_tmp_path(&live).exists() && aside(&wal).exists() && aside(&shm).exists());
        let swapped_in = std::fs::read(&live).unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal set-aside is kept, byte-for-byte");
        assert!(!aside(&shm).exists(), "the index set-aside is removed");
        assert!(!wal.exists() && !shm.exists(), "nothing is put beside the restored file");
        assert_eq!(std::fs::read(&live).unwrap(), swapped_in, "the restored file is not touched");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
    }

    /// A -wal that v1.7.x could not put back (it removed the staged copy
    /// first) sits beside a file Cairn has opened since, in WAL mode. Nothing
    /// proves the swap ran, so the launch keeps it, byte-for-byte; the next
    /// restore names it (CR-U1-53). Its -shm set-aside holds no data and goes.
    #[tokio::test]
    async fn a_wal_a_failed_put_back_left_is_kept_at_launch() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("finance.db");
        let pool = seeded_pool(&live).await;
        sqlx::query("PRAGMA journal_mode = WAL").execute(&pool).await.unwrap();
        pool.close().await; // checkpoints; finance.db stays a WAL-mode file
        let (wal, shm) = (dir.path().join("finance.db-wal"), dir.path().join("finance.db-shm"));
        assert!(!wal.exists() && !shm.exists());
        std::fs::write(aside(&wal), b"FRAMES-THAT-COULD-NOT-GO-BACK").unwrap();
        std::fs::write(aside(&shm), b"OLD-INDEX").unwrap();
        let live_before = std::fs::read(&live).unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"FRAMES-THAT-COULD-NOT-GO-BACK", "kept, byte-for-byte");
        assert!(!aside(&shm).exists(), "the index set-aside is removed");
        assert!(!wal.exists(), "never put back beside a file opened since");
        assert_eq!(std::fs::read(&live).unwrap(), live_before);
    }

    /// Crash point 1, then another Cairn opened finance.db and a -wal was
    /// written beside it before this launch. The launch never touches a file
    /// beside finance.db, and never puts the old -wal back, at this launch
    /// or a later one.
    #[tokio::test]
    async fn a_launch_never_touches_a_wal_written_beside_finance_db_since() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);
        std::fs::write(&wal, b"A-NEWER-WAL").unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(&wal).unwrap(), b"A-NEWER-WAL", "never replaced or removed");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the old -wal is kept where it is");
        assert!(!aside(&shm).exists() && !shm.exists(), "the index set-aside is removed");

        // That Cairn quits cleanly (its -wal is checkpointed away); a later
        // launch still never puts the old -wal back.
        std::fs::remove_file(&wal).unwrap();
        reconcile_interrupted_restore(&live);
        assert!(!wal.exists(), "the old -wal is not put back over a file that moved on");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert!(restore_tmp_path(&live).exists(), "the staged copy stays beside the kept -wal");
    }

    /// Second-round review (MAJOR, probe B1): crash point 1 with a -wal that
    /// holds frames set aside, then the user puts a copy in place by hand,
    /// most naturally the backup being restored, with Finder, a Time Machine
    /// file restore or `cp -p`, each of which keeps its older date. The date
    /// then reads "not written since the staging" and the header is a
    /// rollback-mode Cairn backup's, yet the set-aside -wal belongs to
    /// another file, and SQLite would replay its frames over this one (the
    /// reviewed rule read a 40-row backup as the other file's 40 rows, with
    /// integrity_check ok). The launch keeps the -wal set aside, and
    /// finance.db reads exactly the file the user put there.
    #[tokio::test]
    async fn a_launch_never_puts_back_a_wal_beside_a_finance_db_put_in_place_by_hand() {
        let dir = tempfile::tempdir().unwrap();
        // finance.db: 2 accounts in the file, 3 more only in its -wal.
        let live = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        let (wal, shm) = (PathBuf::from(format!("{}-wal", live.display())), PathBuf::from(format!("{}-shm", live.display())));
        let seed = seeded_pool(&dir.path().join("seed.db")).await;
        sqlx::query("INSERT INTO accounts (name) VALUES ('Only in the backup')").execute(&seed).await.unwrap();
        let backup = dir.path().join("backup.db");
        backup_to(&seed, &backup).await.unwrap();
        seed.close().await;
        let a_day_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(86_400);
        std::fs::File::options().write(true).open(&backup).unwrap().set_modified(a_day_ago).unwrap();
        let old_wal = std::fs::read(&wal).unwrap();
        assert!(old_wal.len() > 32, "the -wal holds frames");
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);

        // The user copies the backup over finance.db by hand, keeping its date.
        std::fs::copy(&backup, &live).unwrap();
        std::fs::File::options().write(true).open(&live).unwrap().set_modified(a_day_ago).unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), old_wal, "the -wal set-aside is kept, byte-for-byte");
        assert!(!wal.exists(), "never put beside a file it may not belong to");
        assert!(!aside(&shm).exists() && !shm.exists(), "the index set-aside is removed");
        assert_eq!(db_content(&live).await, db_content(&backup).await, "finance.db reads exactly the file put there");
    }

    /// A crash during a failed swap's own put-back (Task 6): the -shm went
    /// back, the -wal had not. The launch keeps the -wal set-aside and the
    /// staged copy beside it, and the next restore names the -wal.
    #[tokio::test]
    async fn a_crash_during_a_put_back_is_left_for_the_next_restore_to_name() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        let (live_c, wal_c) = (live.clone(), wal.clone());
        crash_inside(|| {
            swap_staged(
                &live,
                &mut |from: &Path, to: &Path| -> std::io::Result<()> {
                    if to == live_c.as_path() {
                        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
                    }
                    if to == wal_c.as_path() {
                        panic!("simulated: the process stops during the put-back");
                    }
                    std::fs::rename(from, to)
                },
                &mut |p: &Path| real_sync(p),
            )
        });
        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal set-aside is kept, byte-for-byte");
        assert!(!wal.exists());
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm that went back is not touched");
        assert!(restore_tmp_path(&live).exists(), "the staged copy stays beside the kept -wal");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(stage_restore(&backup, &live).await.unwrap_err(), leftover_refusal(&aside(&wal)));
    }

    /// Second-round review (MAJOR, probe C1): a -wal set-aside kept with no
    /// staged copy (a reported stuck put-back, whose message named it), and
    /// the user kept the old file under another name and copied a Cairn
    /// backup in as finance.db. A Cairn backup is a rollback-mode file, like
    /// the copy step 3 puts in place, so the header proves nothing; the
    /// reviewed rule deleted the set-aside, the only copy of the old file's
    /// newest frames. The launch keeps it.
    #[tokio::test]
    async fn a_launch_never_removes_a_wal_set_aside_beside_a_backup_copied_in_by_hand() {
        let dir = tempfile::tempdir().unwrap();
        let live = raw_copy_of_an_open_wal_database(dir.path(), true).await;
        let folder = live.parent().unwrap().to_path_buf();
        let (wal, shm) = (folder.join("finance.db-wal"), folder.join("finance.db-shm"));
        let content = db_content(&live).await;
        std::fs::rename(&wal, aside(&wal)).unwrap(); // the put-back could not move it back
        std::fs::remove_file(&shm).unwrap();
        std::fs::rename(&live, folder.join("finance-before.db")).unwrap();
        let seed = seeded_pool(&dir.path().join("seed.db")).await;
        let backup = dir.path().join("backup.db");
        backup_to(&seed, &backup).await.unwrap();
        seed.close().await;
        std::fs::copy(&backup, &live).unwrap();
        let kept = std::fs::read(aside(&wal)).unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), kept, "the -wal set-aside is kept, byte-for-byte");
        // Beside the file the user kept, it is still that file's newest data.
        let pair = dir.path().join("pair");
        std::fs::create_dir(&pair).unwrap();
        std::fs::copy(folder.join("finance-before.db"), pair.join("finance.db")).unwrap();
        std::fs::copy(aside(&wal), pair.join("finance.db-wal")).unwrap();
        assert_eq!(db_content(&pair.join("finance.db")).await, content, "the kept pair still holds every row");
    }

    /// The v1.7.2 → v1.8.0 path on a real database (plan review R2-1), with
    /// the clock set back (second-round review, probe B1b): an older build
    /// (no reconciliation) ran after a crash between steps 2 and 3, wrote,
    /// and quit cleanly (its -wal checkpointed and removed), and finance.db's
    /// date now reads earlier than the staged copy's. The first launch of
    /// this build keeps the old -wal set aside, and the file stays whole with
    /// the older build's rows.
    #[tokio::test]
    async fn a_launch_never_puts_back_a_wal_after_an_older_build_wrote_even_with_the_clock_set_back() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.db");
        let seed = seeded_pool(&dir.path().join("seed.db")).await;
        backup_to(&seed, &backup).await.unwrap();
        seed.close().await;
        // A WAL-mode finance.db whose newest row is only in its -wal: the
        // three files are copied while the writer is still connected.
        let src_dir = dir.path().join("writer");
        std::fs::create_dir(&src_dir).unwrap();
        let src = src_dir.join("finance.db");
        let pool = seeded_pool(&src).await;
        sqlx::query("PRAGMA journal_mode = WAL").execute(&pool).await.unwrap();
        pool.close().await;
        let mut writer = sqlx::ConnectOptions::connect(&SqliteConnectOptions::new().filename(&src)).await.unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint = 0").execute(&mut writer).await.unwrap();
        sqlx::query("INSERT INTO accounts (name) VALUES ('only_in_the_wal')").execute(&mut writer).await.unwrap();
        let live = dir.path().join("finance.db");
        let (wal, shm) = (dir.path().join("finance.db-wal"), dir.path().join("finance.db-shm"));
        for suffix in ["", "-wal", "-shm"] {
            std::fs::copy(format!("{}{suffix}", src.display()), format!("{}{suffix}", live.display())).unwrap();
        }
        sqlx::Connection::close(writer).await.unwrap();
        let old_wal = std::fs::read(&wal).unwrap();
        assert!(old_wal.len() > 32, "the -wal holds frames");

        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);
        // The older build opens finance.db without its -wal, writes, quits.
        let older = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{}?mode=rw", live.display()))
            .await
            .unwrap();
        sqlx::query("PRAGMA journal_mode = WAL").execute(&older).await.unwrap();
        sqlx::query("INSERT INTO accounts (name) VALUES ('written_by_the_older_build')").execute(&older).await.unwrap();
        older.close().await;
        assert!(!wal.exists() && !shm.exists(), "its clean close removed its own sidecars");
        // The clock was set back: finance.db now reads older than the staged copy.
        let two_hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(7200);
        std::fs::File::options().write(true).open(&live).unwrap().set_modified(two_hours_ago).unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), old_wal, "the old -wal is kept, byte-for-byte");
        assert!(!wal.exists(), "no stale -wal is put beside the file");
        assert!(!aside(&shm).exists(), "the index set-aside is removed");
        assert!(restore_tmp_path(&live).exists(), "the staged copy stays beside the kept -wal");
        let check = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{}?mode=ro", live.display()))
            .await
            .unwrap();
        let quick: String = sqlx::query("PRAGMA quick_check").fetch_one(&check).await.unwrap().get(0);
        assert_eq!(quick, "ok");
        let rows: i64 = sqlx::query("SELECT COUNT(*) FROM accounts WHERE name = 'written_by_the_older_build'")
            .fetch_one(&check)
            .await
            .unwrap()
            .get(0);
        assert_eq!(rows, 1, "the older build's row is there");
        check.close().await;
    }

    /// A kill inside `move_no_replace`, between its link and its unlink,
    /// leaves one -wal under two names. The launch removes neither
    /// (second-round review, probe RACE): with no single-instance guard,
    /// another Cairn's move can be between its own link and unlink at that
    /// moment, and removing one name then lets that unlink remove the last.
    /// The -wal keeps its own name and its frames; the next restore names
    /// the extra one, and moving it out loses nothing.
    #[tokio::test]
    async fn a_move_a_kill_stopped_halfway_is_left_for_the_next_restore_to_name() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        std::fs::hard_link(&wal, aside(&wal)).unwrap(); // step 2 linked the set-aside name; the process stopped before the unlink

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal keeps its own name");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "its second name is kept too");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX");
        assert!(restore_tmp_path(&live).exists(), "the staged copy stays beside the kept -wal");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(stage_restore(&backup, &live).await.unwrap_err(), leftover_refusal(&aside(&wal)));
    }

    /// The shape this build's own crashes leave (the exclusivity check's
    /// close drains the -wal before step 2, Task 8): only the -shm was set
    /// aside. At either crash point the launch removes the index set-aside,
    /// and the staged copy when it is there; finance.db is left exactly as
    /// it is, and nothing is put beside it.
    #[tokio::test]
    async fn a_launch_removes_the_index_set_aside_and_the_staged_copy_when_no_wal_was_set_aside() {
        // Crash point 1.
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::remove_file(&wal).unwrap();
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);
        assert!(restore_tmp_path(&live).exists() && aside(&shm).exists() && !aside(&wal).exists());
        reconcile_interrupted_restore(&live);
        assert!(!aside(&shm).exists(), "the index set-aside is removed");
        assert!(!restore_tmp_path(&live).exists(), "the staged copy is removed");
        assert!(!wal.exists() && !shm.exists(), "nothing is put beside finance.db");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");

        // Crash point 2.
        let (_dir2, backup2, live2, wal2, shm2) = live_with_sidecars().await;
        std::fs::remove_file(&wal2).unwrap();
        stage_restore(&backup2, &live2).await.expect("staged");
        crash_right_after_the_swap(&live2);
        let swapped_in = std::fs::read(&live2).unwrap();
        reconcile_interrupted_restore(&live2);
        assert!(!aside(&shm2).exists(), "the index set-aside is removed");
        assert!(!wal2.exists() && !shm2.exists(), "nothing is put beside the restored file");
        assert_eq!(std::fs::read(&live2).unwrap(), swapped_in, "the restored file is not touched");
        assert_eq!(db_content(&live2).await, db_content(&backup2).await);
    }

    /// Nothing at finance.db's own sidecar names is ever replaced or
    /// removed: after crash point 1 with only the -shm set aside, another
    /// Cairn opened finance.db and wrote a -wal and a -shm beside it. The
    /// launch removes the index set-aside and the staged copy, and leaves
    /// both of those.
    #[tokio::test]
    async fn a_launch_never_touches_the_sidecars_beside_finance_db() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        std::fs::remove_file(&wal).unwrap();
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);
        std::fs::write(&wal, b"A-NEWER-WAL").unwrap();
        std::fs::write(&shm, b"A-NEWER-INDEX").unwrap();

        reconcile_interrupted_restore(&live);
        assert_eq!(std::fs::read(&wal).unwrap(), b"A-NEWER-WAL", "never replaced or removed");
        assert_eq!(std::fs::read(&shm).unwrap(), b"A-NEWER-INDEX", "never replaced or removed");
        assert!(!aside(&shm).exists() && !restore_tmp_path(&live).exists());
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
    }

    /// Nothing set aside: the launch changes nothing, not even a lone staging
    /// file (the next restore removes it before it stages).
    #[tokio::test]
    async fn a_launch_with_nothing_to_settle_changes_nothing() {
        let (dir, _backup, live, _wal, _shm) = live_with_sidecars().await;
        std::fs::write(restore_tmp_path(&live), b"LEFT BY A RESTORE THAT STOPPED WHILE STAGING").unwrap();
        let listing = |d: &Path| {
            let mut v: Vec<(String, Vec<u8>)> = std::fs::read_dir(d)
                .unwrap()
                .map(|e| e.unwrap())
                .filter(|e| e.file_type().unwrap().is_file())
                .map(|e| (e.file_name().to_string_lossy().into_owned(), std::fs::read(e.path()).unwrap()))
                .collect();
            v.sort();
            v
        };
        let before = listing(dir.path());
        reconcile_interrupted_restore(&live);
        assert_eq!(listing(dir.path()), before);
    }

    /// Code review (v1.8.0 H2): only NotFound proves a name is free. A -wal
    /// set-aside whose name Cairn cannot look at (any other lstat error) is
    /// read as there: the launch keeps the staged copy beside it, and the
    /// check before the close and step 0b still refuse, naming it.
    #[tokio::test]
    async fn a_wal_set_aside_cairn_cannot_look_at_is_read_as_there() {
        fn the_wal_set_aside(p: &Path) -> bool {
            p.to_string_lossy().ends_with("-wal.restore-old")
        }
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        stage_restore(&backup, &live).await.expect("staged");
        crash_before_the_swap(&live);

        LOOKUP_FAILS.with(|hook| *hook.borrow_mut() = Some(the_wal_set_aside));
        reconcile_interrupted_restore(&live);
        let kept_the_staged_copy = restore_tmp_path(&live).exists();
        let checked = refuse_before_close(&backup, &live);
        let staged = stage_restore(&backup, &live).await;
        LOOKUP_FAILS.with(|hook| *hook.borrow_mut() = None);

        assert!(kept_the_staged_copy, "the staged copy stays beside a -wal set-aside that may be there");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"COMMITTED-WAL-FRAMES", "the -wal set-aside is kept");
        assert!(!aside(&shm).exists(), "the index set-aside is removed");
        assert_eq!(checked, Err(leftover_refusal(&aside(&wal))), "the check before the close refuses");
        assert_eq!(staged.unwrap_err(), leftover_refusal(&aside(&wal)), "step 0b refuses");
    }

    /// The same through the file system (unix): the folder lists its names
    /// but nothing in it can be looked up, so lstat answers "permission
    /// denied", not "not found". The -wal set-aside it holds still refuses
    /// the check before the close and step 0b, and nothing is touched.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_wal_set_aside_in_a_folder_cairn_cannot_search_still_refuses() {
        use std::os::unix::fs::PermissionsExt;

        let (dir, backup, live, wal, _shm) = live_with_sidecars().await;
        let elsewhere = tempfile::tempdir().unwrap();
        let chosen = elsewhere.path().join("backup.db");
        std::fs::copy(&backup, &chosen).unwrap();
        std::fs::write(aside(&wal), b"EARLIER").unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o600)).unwrap();

        let checked = refuse_before_close(&chosen, &live);
        let staged = stage_restore(&chosen, &live).await;

        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(checked, Err(leftover_refusal(&aside(&wal))), "the check before the close refuses");
        assert_eq!(staged.unwrap_err(), leftover_refusal(&aside(&wal)), "step 0b refuses");
        assert_eq!(std::fs::read(aside(&wal)).unwrap(), b"EARLIER");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert!(!restore_tmp_path(&live).exists());
    }

    /// Mirror pin of the TS `DB_URL` (src/lib/backup-restore.ts); also pinned
    /// across the languages in tests/policy/ipc-parity.test.ts.
    #[test]
    fn live_db_url_is_pinned() {
        assert_eq!(LIVE_DB_URL, "sqlite:finance.db");
    }

    /// Chip v: a put-back that fails for a moment (a scanner or the indexer
    /// holding the file) is tried again after a short pause, so the -wal goes
    /// back and "(your data is unchanged)" is true.
    #[tokio::test]
    async fn a_put_back_that_fails_for_a_moment_is_tried_again() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let (live_c, wal_c) = (live.clone(), wal.clone());
        let attempts = std::cell::Cell::new(0);
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            if to == wal_c.as_path() {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 3 {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: held for a moment"));
                }
            }
            std::fs::rename(from, to)
        };
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert_eq!(attempts.get(), 3, "two retries after the first attempt");
        assert_eq!(
            RETRY_PAUSES.with(|p| p.borrow().clone()),
            [std::time::Duration::from_millis(50), std::time::Duration::from_millis(200)],
            "a pause of 50 ms, then of 200 ms, before the two retries"
        );
        assert!(msg.contains("failed to finalize the restore (your data is unchanged)"), "{msg}");
        assert_untouched(&live, &wal, &shm);
    }

    /// Chip v: the pauses are real pauses (the other tests record them and
    /// skip the sleep).
    #[tokio::test]
    async fn a_put_back_retry_really_pauses_between_its_tries() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let (live_c, wal_c) = (live.clone(), wal.clone());
        let attempts = std::cell::Cell::new(0);
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            if to == wal_c.as_path() {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 3 {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: held for a moment"));
                }
            }
            std::fs::rename(from, to)
        };
        REAL_RETRY_PAUSES.with(|r| r.set(true));
        let started = std::time::Instant::now();
        let result = replace_database_file_with(&backup, &live, &mut rename).await;
        let elapsed = started.elapsed();
        REAL_RETRY_PAUSES.with(|r| r.set(false));
        assert!(result.is_err());
        assert_eq!(attempts.get(), 3, "two retries after the first attempt");
        assert!(elapsed >= std::time::Duration::from_millis(250), "slept 50 ms + 200 ms, took {elapsed:?}");
        assert_untouched(&live, &wal, &shm);
    }

    /// Chip v: a file already at the sidecar's name, or a set-aside file that
    /// is gone, does not change with a pause, so that put-back is not retried.
    #[tokio::test]
    async fn a_put_back_onto_a_sidecar_created_meanwhile_is_tried_once() {
        let (_dir, backup, live, wal, _shm) = live_with_sidecars().await;
        let (live_c, wal_c) = (live.clone(), wal.clone());
        let attempts = std::cell::Cell::new(0);
        let mut production = swap_move(&live);
        let mut rename = |from: &Path, to: &Path| -> std::io::Result<()> {
            if to == live_c.as_path() {
                std::fs::write(&wal_c, b"A-NEWER-WAL").unwrap();
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated: the final rename is refused"));
            }
            if to == wal_c.as_path() {
                attempts.set(attempts.get() + 1);
            }
            production(from, to)
        };
        let started = std::time::Instant::now();
        let msg = replace_database_file_with(&backup, &live, &mut rename).await.unwrap_err();
        assert!(msg.contains("could not be put back"), "{msg}");
        assert_eq!(attempts.get(), 1, "AlreadyExists is reported at once");
        assert!(RETRY_PAUSES.with(|p| p.borrow().is_empty()), "no pause was asked for");
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "no pause was taken");
    }

    /// Code review (X31): a whole swap through the production moves with both
    /// sidecars present (the seam runs no exclusivity check, so the -wal is
    /// set aside too). Step 4 removes both set-asides, nothing sits beside
    /// the restored file, and it holds exactly the backup's content.
    #[tokio::test]
    async fn a_swap_through_the_production_moves_leaves_only_the_restored_file() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        replace_database_file_with(&backup, &live, &mut swap_move(&live)).await.expect("restored");
        assert!(!aside(&wal).exists(), "step 4 removed the -wal set-aside");
        assert!(!aside(&shm).exists(), "step 4 removed the -shm set-aside");
        assert!(!wal.exists() && !shm.exists(), "nothing sits beside the restored file");
        assert!(!restore_tmp_path(&live).exists(), "no staging file left behind");
        assert_eq!(db_content(&live).await, db_content(&backup).await);
    }

    /// Chip t, step 2's half: setting a sidecar aside never replaces a
    /// set-aside file that appeared after step 0 looked (another restore's,
    /// meanwhile). Pinned through the production entry point.
    #[tokio::test]
    async fn a_set_aside_never_replaces_a_file_made_meanwhile() {
        fn another_restores_index_appears(tmp: &Path) {
            let live = tmp.to_string_lossy().trim_end_matches(".restore-tmp").to_string();
            std::fs::write(format!("{live}-shm.restore-old"), b"ANOTHER-RESTORE-INDEX").unwrap();
        }
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        AFTER_STAGE.with(|hook| *hook.borrow_mut() = Some(another_restores_index_appears));
        let result = replace_database_file(&backup, &live).await;
        AFTER_STAGE.with(|hook| *hook.borrow_mut() = None);
        let msg = result.unwrap_err();
        assert!(
            msg.starts_with(&format!("db_restore: could not set aside the WAL sidecar {} (your data is unchanged): ", shm.display())),
            "{msg}"
        );
        assert_eq!(std::fs::read(aside(&shm)).unwrap(), b"ANOTHER-RESTORE-INDEX", "the file already set aside is never replaced");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX", "the -shm stays where it was");
        // The exclusivity check (Task 8) ran before step 2: nothing else held
        // the file, so its close removed this -wal, which SQLite reads as
        // zero frames (shorter than the 32-byte WAL header; probe P3). Step 2
        // then had no -wal to set aside (plan review R1-2/R2-4: its fate is
        // pinned, not hidden).
        assert!(!wal.exists(), "the check removed the -wal SQLite reads as holding no frames");
        assert!(!aside(&wal).exists(), "no -wal is left set aside");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert!(!restore_tmp_path(&live).exists(), "no staging file left behind");
    }

    #[test]
    fn move_no_replace_never_replaces_a_file_and_moves_when_the_name_is_free() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("from"), dir.path().join("to"));
        std::fs::write(&from, b"FROM").unwrap();
        std::fs::write(&to, b"TO").unwrap();
        let e = move_no_replace(&from, &to).unwrap_err();
        assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&from).unwrap(), b"FROM");
        assert_eq!(std::fs::read(&to).unwrap(), b"TO", "the file already there is untouched");
        std::fs::remove_file(&to).unwrap();
        move_no_replace(&from, &to).expect("moves when the name is free");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"FROM");
    }

    /// Chip w, the naming half: a staging file an interrupted restore left,
    /// which Cairn cannot remove, is named with the calm next step. Before,
    /// the staging failure it caused did not say which file was in the way.
    #[tokio::test]
    async fn a_staging_file_cairn_cannot_remove_is_named() {
        let (_dir, backup, live, wal, shm) = live_with_sidecars().await;
        let tmp = restore_tmp_path(&live);
        std::fs::create_dir(&tmp).unwrap(); // remove_file cannot remove a folder
        let err = replace_database_file(&backup, &live).await.unwrap_err();
        assert_eq!(
            err,
            format!(
                "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
                tmp.display()
            )
        );
        assert!(tmp.is_dir(), "the leftover stays where it is");
        assert_eq!(std::fs::read(&live).unwrap(), b"ORIGINAL-LIVE-DB");
        assert_eq!(std::fs::read(&wal).unwrap(), b"COMMITTED-WAL-FRAMES");
        assert_eq!(std::fs::read(&shm).unwrap(), b"SHM-INDEX");
        assert!(!aside(&wal).exists() && !aside(&shm).exists(), "nothing was set aside");
    }

    /// v1.7.2 chip e, the Windows half (compiled only on Windows; it runs on
    /// v171-1's Windows cargo job): a file the validator refused can be
    /// removed at once, because its connection was closed before the verdict
    /// returned.
    #[cfg(windows)]
    #[tokio::test]
    async fn the_validator_leaves_a_refused_file_removable_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty.db");
        std::fs::write(&empty, b"").unwrap();
        assert!(!validate_backup_file(&empty).await.ok);
        std::fs::remove_file(&empty).expect("no handle is left open on the refused file");
    }

    /// M-3: pin the Rust schema-version constant to the literal so a one-sided
    /// bump (Rust-only) trips `cargo test` — not just JS-side review. The JS
    /// `MAX_SCHEMA_VERSION` is asserted equal to this literal AND to the
    /// migration count in `tests/db/schema-version-guard.test.ts`.
    /// Version-free name on purpose: the constant's doc comment references
    /// this test, and a versioned name went stale on the 50→51 bump.
    #[test]
    fn max_schema_version_is_pinned() {
        assert_eq!(MAX_SCHEMA_VERSION, 55);
    }

    /// W4: the allowlist is EQUALITY on the one sample URL — `db_sample_reset`
    /// must be impossible to aim at finance.db (or anything else).
    #[test]
    fn sample_reset_allowlist_refuses_everything_but_the_sample_url() {
        assert!(ensure_sample_url(SAMPLE_DB_URL).is_ok());
        for bad in [
            "sqlite:finance.db",
            "sqlite:sample-explore.db2",
            "sqlite:./sample-explore.db",
            "sample-explore.db",
            "",
            "sqlite:../finance.db",
            // W4 review (MINOR 2): the six above kill `starts_with` and
            // `contains` mutants but NOT `ends_with`, `eq_ignore_ascii_case`
            // or `trim() ==`. These do — the rule is EQUALITY, and the test's
            // name says "everything but the sample url".
            "x sqlite:sample-explore.db",              // ends_with
            "SQLITE:SAMPLE-EXPLORE.DB",                // eq_ignore_ascii_case
            "sqlite:sample-explore.db ",               // trailing space  → trim()
            " sqlite:sample-explore.db",               // leading space   → trim()
            "sqlite:sample-explore.db?mode=rwc",       // query suffix
            "sqlite:../x:sqlite:sample-explore.db",    // embedded
        ] {
            let err = ensure_sample_url(bad).unwrap_err();
            assert!(err.contains("refusing"), "{bad}: {err}");
        }
    }

    /// W4: mirror pin of the TS `EXPLORE_DB_URL` (src/lib/explore-mode.ts) —
    /// the MAX_SCHEMA_VERSION mirror-pin precedent. Also regex-pinned
    /// cross-language in tests/policy/ipc-parity.test.ts.
    #[test]
    fn sample_db_url_is_pinned() {
        assert_eq!(SAMPLE_DB_URL, "sqlite:sample-explore.db");
    }

    #[test]
    fn remove_db_files_deletes_main_and_both_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("sample-explore.db");
        for p in [
            live.clone(),
            dir.path().join("sample-explore.db-wal"),
            dir.path().join("sample-explore.db-shm"),
        ] {
            std::fs::write(&p, b"x").unwrap();
        }
        remove_db_files(&live).unwrap();
        assert!(!live.exists());
        assert!(!dir.path().join("sample-explore.db-wal").exists());
        assert!(!dir.path().join("sample-explore.db-shm").exists());
    }

    #[test]
    fn remove_db_files_is_a_no_op_when_nothing_exists() {
        let dir = tempfile::tempdir().unwrap();
        remove_db_files(&dir.path().join("sample-explore.db")).unwrap();
    }

    /// W4 review (MINOR 3): only ErrorKind::NotFound is tolerated — every
    /// other io error must surface, so a locked or permission-denied sample
    /// file fails LOUDLY instead of silently booting over a stale DB. A
    /// `Err(_) => {}` mutant compiled and passed before this test existed.
    /// A directory at the main path is the portable non-NotFound failure
    /// (EISDIR on Linux, EPERM on macOS).
    #[test]
    fn remove_db_files_surfaces_a_non_not_found_delete_failure() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("sample-explore.db");
        std::fs::create_dir(&live).unwrap();
        let err = remove_db_files(&live).unwrap_err();
        assert!(err.contains("could not delete"), "{err}");
        assert!(live.exists(), "the directory must still be there");
    }

    /// Build a `DbInstances` holding one open pool under `key`.
    async fn instances_with(key: &str, path: &Path) -> (DbInstances, Pool<Sqlite>) {
        let pool = seeded_pool(path).await;
        let map = std::collections::HashMap::from([(
            key.to_string(),
            DbPool::Sqlite(pool.clone()),
        )]);
        (DbInstances(tokio::sync::RwLock::new(map)), pool)
    }

    /// W4 review (REFUTED 0, pinned anyway — cheap): the allowlist call is
    /// the ENTIRE enforcement of D-S8 inside the command body, and deleting
    /// `ensure_sample_url(&db)?` compiled and passed 21/21. The command is a
    /// thin wrapper over this guarded free function, so the wiring is now
    /// covered without constructing an AppHandle (the house split stands).
    #[tokio::test]
    async fn sample_reset_refuses_the_real_db_without_touching_the_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("finance.db");
        std::fs::write(&live, b"the user's only copy").unwrap();
        let (instances, pool) = instances_with(SAMPLE_DB_URL, &dir.path().join("sample.db")).await;

        let resolved = std::cell::Cell::new(false);
        let err = sample_reset_guarded(&instances, "sqlite:finance.db", |_| {
            resolved.set(true);
            Ok(live.clone())
        })
        .await
        .unwrap_err();

        assert!(err.contains("refusing"), "{err}");
        assert!(!resolved.get(), "the path must never even be resolved");
        assert!(live.exists(), "finance.db must be untouched");
        assert_eq!(
            std::fs::read(&live).unwrap(),
            b"the user's only copy",
            "finance.db must be byte-identical"
        );
        // The refused call must also leave the pool map alone.
        assert!(instances.0.read().await.contains_key(SAMPLE_DB_URL));
        pool.close().await;
    }

    /// W4 review (REFUTED 1, pinned anyway — cheap): P-W4-3 makes the
    /// pool-drop load-bearing (a prior session's pool survives webview
    /// reloads in the Rust process and would hold the file open on Windows).
    /// Replacing the remove+close block with a bare drop passed 21/21 before.
    #[tokio::test]
    async fn sample_reset_forgets_and_closes_the_sample_pool() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("sample-explore.db");
        let (instances, probe) = instances_with(SAMPLE_DB_URL, &live).await;
        assert!(!probe.is_closed());

        sample_reset_guarded(&instances, SAMPLE_DB_URL, |_| Ok(live.clone()))
            .await
            .expect("the sample URL is the one allowed URL");

        assert!(
            !instances.0.read().await.contains_key(SAMPLE_DB_URL),
            "the URL must be fully forgotten, not just closed in place"
        );
        assert!(probe.is_closed(), "the removed pool must be closed");
        assert!(!live.exists(), "the sample file must be gone");
    }
}
