import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  isTauriRuntime,
  runBackup,
  saveBackupCopy,
  revealBackupsDir,
  listBackups,
  backupsDirPath,
  validateBackupFile,
  restoreFromBackup,
  takeRestoreFailureNotice,
  type BackupEntry,
} from '@/lib/backup-restore';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

/** Human-readable "when this backup was taken", e.g. "Jun 2, 2026, 11:50 PM". */
function formatTakenAt(takenAt: Date): string {
  return takenAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Settings → Data section. The REAL backup/restore surface for the app's
 * 100%-local, irreplaceable data.
 *
 * "Back up now" takes a consistent whole-file copy of the entire database
 * (every table) into a rotating `backups/` folder beside the live data via the
 * Rust `db_backup` command (VACUUM INTO). "Save a copy…" writes a fresh backup
 * to any location via a native save dialog. "Reveal backups in Finder" opens
 * the rotating folder.
 *
 * RESTORE is list-driven. The rotating `backups/` folder lives under the app
 * config dir (`~/Library/Application Support/…/backups/`) — a HIDDEN location
 * the user can't browse to in a file dialog. So instead of only opening a
 * picker, we LIST those backups in-app (`listBackups`) and give each a Restore
 * button. A "Restore from a file…" escape hatch remains for backups saved
 * elsewhere; it opens the picker defaulted INTO the backups folder. Both paths
 * funnel through `doRestore`: validate → destructive confirm → swap + reload.
 *
 * Browser mode (`dev:browser`, no Rust): the `invoke`/path/dialog/opener calls
 * have no runtime, so the actions are gated behind `isTauriRuntime()` and a
 * short "available in the desktop app" note is shown instead. The list simply
 * never loads in browser mode (the smoke runs there); only the live desktop
 * build exercises the real backup/restore.
 */
export function DataSection() {
  const tauri = isTauriRuntime();
  const { confirm, dialog } = useConfirm();

  const [busy, setBusy] = useState<null | 'backup' | 'save' | 'restore'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  // Load (and reload) the rotating backups list. Best-effort: a failure leaves
  // the list as-is and surfaces a soft note rather than blocking the section.
  const refreshBackups = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setBackups(await listBackups());
    } catch (e) {
      setError(`Could not read your backups: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // Populate the list on mount (desktop only — browser mode has no fs runtime).
  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  // Auto-clear the transient success notice so the section doesn't accumulate
  // stale messages across actions. Errors persist until the next action.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(t);
  }, [status]);

  // If a restore failed last session, the forced reload (M-4) left a reason in
  // sessionStorage. Surface it here (read-once) so the user learns why — their
  // original data is intact (H-1), and they can retry.
  useEffect(() => {
    const reason = takeRestoreFailureNotice();
    if (reason) setError(`Restore did not complete: ${reason}. Your data was not changed.`);
  }, []);

  async function handleBackupNow() {
    setError(null);
    setStatus(null);
    setBusy('backup');
    try {
      const dest = await runBackup();
      setStatus(`Backed up to ${dest}`);
      // Surface the fresh backup in the list immediately.
      await refreshBackups();
    } catch (e) {
      setError(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveCopy() {
    setError(null);
    setStatus(null);
    setBusy('save');
    try {
      const dest = await saveBackupCopy();
      if (dest) setStatus(`Saved a copy to ${dest}`);
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleReveal() {
    setError(null);
    try {
      await revealBackupsDir();
    } catch (e) {
      setError(`Could not open the backups folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The shared destructive-restore flow used by BOTH the per-row Restore and the
   * file picker: read-only validate → destructive confirm (naming which backup
   * when `whenLabel` is given) → swap the live DB + reload. `restoreFromBackup`
   * reloads the webview on success, so nothing after it runs in the happy path.
   */
  async function doRestore(source: string, whenLabel?: string) {
    setError(null);
    setStatus(null);

    // Read-only pre-flight before we even show the destructive confirm.
    let validation;
    try {
      validation = await validateBackupFile(source);
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!validation.ok) {
      setError(validation.reason ?? 'That file is not a valid Cairn backup.');
      return;
    }

    const ok = await confirm({
      title: 'Replace all current data?',
      description:
        `This permanently replaces every account, transaction, setting, and all ` +
        `other data in Cairn with the contents of ` +
        (whenLabel ? `the backup from ${whenLabel}` : 'the selected backup') +
        `. This cannot be undone. Cairn will reload when the restore finishes.`,
      confirmLabel: 'Replace and restore',
    });
    if (!ok) return;

    setBusy('restore');
    try {
      // On success this reloads the webview, so code after it won't run.
      await restoreFromBackup(source);
    } catch (e) {
      setError(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
    }
  }

  /** Per-row Restore: hand the backup's path + formatted date to doRestore. */
  function handleRestoreEntry(b: BackupEntry) {
    void doRestore(b.path, formatTakenAt(b.takenAt));
  }

  /** "Restore from a file…": pick a `.db` (defaulting INTO the hidden backups
   * folder so it's reachable), then run the shared restore flow. */
  async function handleRestoreFromFile() {
    setError(null);
    setStatus(null);
    let source: string | null = null;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: await backupsDirPath(),
        filters: [{ name: 'Cairn backup', extensions: ['db'] }],
      });
      source = typeof picked === 'string' ? picked : null;
    } catch (e) {
      setError(`Could not open the file picker: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!source) return; // user cancelled
    await doRestore(source);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Your data lives only on this Mac. Back it up regularly so you can
          recover everything — every account, transaction, and setting — if this
          Mac is lost or the database is damaged. Backups are full, exact copies
          of your database.
        </p>

        {!tauri && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="desktop-only-note"
          >
            Backup and restore are available in the Cairn desktop app.
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Back up</h3>
            <p className="text-sm text-muted-foreground">
              Save a complete copy of your database. Cairn keeps your most recent
              backups in a folder next to your data.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleBackupNow} disabled={!tauri || busy !== null}>
                {busy === 'backup' ? 'Backing up…' : 'Back up now'}
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveCopy}
                disabled={!tauri || busy !== null}
              >
                {busy === 'save' ? 'Saving…' : 'Save a copy…'}
              </Button>
              <Button variant="ghost" onClick={handleReveal} disabled={!tauri}>
                Reveal backups in Finder
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Restore</h3>
            <p className="text-sm text-muted-foreground">
              Replace all current data with one of your recent backups. Cairn
              checks the file, then reloads. This cannot be undone.
            </p>

            {backups.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border">
                {backups.map((b) => (
                  <li
                    key={b.path}
                    data-testid="backup-row"
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm">{formatTakenAt(b.takenAt)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestoreEntry(b)}
                      disabled={!tauri || busy !== null}
                    >
                      {busy === 'restore' ? 'Restoring…' : 'Restore'}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              tauri && (
                <EmptyState
                  bare
                  icon={History}
                  title="No backups yet"
                  description="Click “Back up now” to create one."
                />
              )
            )}

            <Button
              variant="ghost"
              onClick={handleRestoreFromFile}
              disabled={!tauri || busy !== null}
            >
              Restore from a file…
            </Button>
          </div>
        </div>

        {status && (
          <p
            className="text-sm text-muted-foreground break-all"
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive-soft-foreground break-all" role="alert">
            {error}
          </p>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
