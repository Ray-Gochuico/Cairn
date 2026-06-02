import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  isTauriRuntime,
  runBackup,
  saveBackupCopy,
  revealBackupsDir,
  validateBackupFile,
  restoreFromBackup,
  takeRestoreFailureNotice,
} from '@/lib/backup-restore';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

/**
 * Settings → Data section. The REAL backup/restore surface for the app's
 * 100%-local, irreplaceable data.
 *
 * "Back up now" takes a consistent whole-file copy of the entire database
 * (every table) into a rotating `backups/` folder beside the live data via the
 * Rust `db_backup` command (VACUUM INTO). "Save a copy…" writes a fresh backup
 * to any location via a native save dialog. "Reveal backups in Finder" opens
 * the rotating folder. "Restore from backup…" validates a chosen `.db`, asks
 * for destructive confirmation, swaps the live file, and reloads.
 *
 * Browser mode (`dev:browser`, no Rust): the `invoke`/path/dialog/opener calls
 * have no runtime, so the actions are gated behind `isTauriRuntime()` and a
 * short "available in the desktop app" note is shown instead. The component
 * still renders (the smoke runs in the browser); only the live desktop build
 * exercises the real backup/restore.
 */
export function DataSection() {
  const tauri = isTauriRuntime();
  const { confirm, dialog } = useConfirm();

  const [busy, setBusy] = useState<null | 'backup' | 'save' | 'restore'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function handleRestore() {
    setError(null);
    setStatus(null);
    let source: string | null = null;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Cairn backup', extensions: ['db'] }],
      });
      source = typeof picked === 'string' ? picked : null;
    } catch (e) {
      setError(`Could not open the file picker: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!source) return; // user cancelled

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
        'This permanently replaces every account, transaction, setting, and all ' +
        'other data in Cairn with the contents of the selected backup. This cannot ' +
        'be undone. Cairn will reload when the restore finishes.',
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
              Replace all current data with a backup file. Choose a{' '}
              <code>.db</code> backup; Cairn checks it, then reloads.
            </p>
            <Button
              variant="outline"
              onClick={handleRestore}
              disabled={!tauri || busy !== null}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore from backup…'}
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
