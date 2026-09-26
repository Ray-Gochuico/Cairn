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
//!    the backup into a sibling temp file THROUGH SQLite (`VACUUM INTO`, so a
//!    `-wal` beside the backup is read too — v1.7.2), sets the OLD `-wal`/`-shm` sidecars
//!    ASIDE (renamed, put back if the swap fails, deleted only after it
//!    succeeds — v1.7.1 CR-U-15), then `rename`s the temp file over `finance.db`.
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
//! command. On the boot-screen path where no pool was ever loaded, no
//! checkpoint ran, which is why step 3 sets the sidecars aside instead of
//! deleting them: a failed swap puts them back, so the original data (file +
//! WAL) survives. The close → invoke → reload contract is load-bearing and
//! enforced in `src/lib/backup-restore.ts`.

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
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
/// put_back_or_report); a crash between steps 2 and 3 is not reconciled yet —
/// a chip):
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
///   2. RENAME the old `-wal` / `-shm` aside to `<sidecar>.restore-old` (a
///      missing sidecar is skipped). They must not sit next to the restored
///      file — a stale WAL would be replayed over it on reopen — but they are
///      only moved, so a failure here or in step 3 renames them back.
///   3. `rename(tmp, live)` — atomic on the same filesystem. Before it, `live`
///      is the intact original; after it, `live` IS the restored backup.
///   4. Only now delete the set-aside sidecars (they belonged to the replaced
///      file; best-effort).
///
/// On a failure in steps 2–3 every moved sidecar is renamed back. Every
/// sidecar that cannot go back is named with where it is (the file is kept).
/// "(your data is unchanged)" is dropped, and "could not be put back" used,
/// ONLY when the `-wal` is stuck; a stuck `-shm` alone is reported calmly
/// (see put_back_or_report, CR-U-23c).
pub async fn replace_database_file(backup: &Path, live: &Path) -> Result<(), String> {
    stage_restore(backup, live).await?;
    // The two seams are made after the last await: a `&mut dyn FnMut` held
    // across an await would make the db_restore command's future !Send.
    swap_staged(live, &mut |from: &Path, to: &Path| std::fs::rename(from, to), &mut |p: &Path| real_sync(p))
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
/// error return leaves `live` and its sidecars untouched and no staging file
/// behind.
async fn stage_restore(backup: &Path, live: &Path) -> Result<(), String> {
    let tmp = restore_tmp_path(live);
    let sidecars = sidecar_paths(live);
    let asides = [set_aside_path(&sidecars[0]), set_aside_path(&sidecars[1])];

    // 0a. Never restore FROM this module's own staging file (U1F-m9): step 1
    //     removes a leftover staging file before staging, so restoring FROM
    //     it would delete the file chosen.
    if let (Ok(src), Ok(staging)) = (backup.canonicalize(), tmp.canonicalize()) {
        if src == staging {
            return Err(
                "db_restore: the selected file is Cairn's own restore staging file, not a backup (your data is unchanged)"
                    .to_string(),
            );
        }
    }

    // 0b. Never overwrite a set-aside -wal an earlier restore left: it may
    //     hold that session's committed frames. The refusal names it and the
    //     calm next step (CR-U-20a, U1F-m1/m19). A leftover -shm set-aside is
    //     SQLite's rebuildable index and holds no data, so it never refuses
    //     (CR-U-25): it is removed here best-effort, and step 2's rename
    //     replaces it anyway if that removal failed.
    let [wal_aside, shm_aside] = &asides;
    if std::fs::symlink_metadata(wal_aside).is_ok() {
        return Err(format!(
            "db_restore: {} from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)",
            wal_aside.display()
        ));
    }
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
    //    step 0a refuses to restore FROM it).
    let _ = std::fs::remove_file(&tmp);
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
/// aside, swap, clean up). Synchronous: `rename` and `sync` are the test
/// seams.
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

    // 2. Set the OLD sidecars aside (rename, never delete) so nothing can
    //    shadow the restored file, while keeping them for a put-back.
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (sidecar, aside) in sidecars.iter().zip(asides.iter()) {
        match rename(sidecar, aside) {
            Ok(()) => moved.push((sidecar.clone(), aside.clone())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                let step = format!("could not set aside the WAL sidecar {}", sidecar.display());
                return Err(put_back_or_report(&moved, rename, &step, &e));
            }
        }
    }

    // 3. Atomic swap. Either `live` is the intact original (rename never ran) or
    //    it is the fully-restored backup (rename returned) — never a partial.
    if let Err(e) = rename(&tmp, live) {
        let _ = std::fs::remove_file(&tmp);
        return Err(put_back_or_report(&moved, rename, "failed to finalize the restore", &e));
    }

    // 4. The swap succeeded: the set-aside sidecars belonged to the replaced
    //    file. Best-effort removal (a leftover only makes the NEXT restore
    //    refuse at step 0, naming the file).
    for (_, aside) in &moved {
        let _ = std::fs::remove_file(aside);
    }
    Ok(())
}

/// Rename every set-aside sidecar back (newest move first) and build the
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
        if let Err(back) = rename(aside, sidecar) {
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
/// an error (and leaves the live DB untouched) if validation fails.
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
    if let (Ok(a), Ok(b)) = (source.canonicalize(), live.canonicalize()) {
        if a == b {
            return Err("db_restore: the selected backup IS the live database.".to_string());
        }
    }

    // 3. Swap the file; the old sidecars are set aside and put back if the
    //    swap fails. The live pool was closed by the JS caller before this
    //    invoke (or was never loaded, on the boot-screen path).
    replace_database_file(source, live).await
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

    #[tokio::test]
    async fn validate_reads_a_name_with_a_question_mark_as_written() {
        let (_dir, path) = backup_named("backup?v=1.db").await;
        let v = validate_backup_file(&path).await;
        assert!(v.ok, "{:?}", v.reason);
    }

    #[tokio::test]
    async fn restore_checked_restores_the_file_named_whatever_its_name() {
        for name in ["Cairn%20backup.db", "backup?v=1.db"] {
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
        assert!(
            err.starts_with("db_restore: failed to stage the backup (your data is unchanged): This backup was created by a newer version of Cairn (schema 60;"),
            "{err}"
        );
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
