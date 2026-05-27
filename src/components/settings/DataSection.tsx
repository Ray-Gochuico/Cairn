import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  serializeBackup,
  deserializeBackup,
  type Backup,
  type BackupData,
} from '@/lib/backup-restore';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { useLoanPaymentsStore } from '@/stores/loan-payments-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useGoalsStore } from '@/stores/goals-store';

/**
 * Settings → Data section. Absorbs the former standalone /backup-restore page.
 *
 * Export reads each store's current in-memory state, wraps it in a versioned
 * envelope, and triggers a browser download via Blob + anchor click. We use
 * native browser APIs (not tauri-plugin-dialog/fs) because those plugins
 * aren't installed; adding them would require Cargo + Rust capability changes.
 * Browser APIs work in both the Tauri webview and a plain browser.
 *
 * Restore reads a user-selected file with FileReader, validates it with
 * BackupSchema, and gates destructive replacement behind a confirmation
 * modal. The actual delete-and-reinsert is stubbed (see applyBackup): a
 * proper implementation needs `deleteAll()` on every domain repo, which
 * is a separate refactor task.
 */

/**
 * Snapshot the current contents of all stores into a BackupData payload.
 * Reads `getState()` directly so this can be called from event handlers
 * without subscribing the component to every store.
 */
function snapshotStores(): BackupData {
  return {
    household: useHouseholdStore.getState().household,
    persons: usePersonsStore.getState().persons,
    dependents: useDependentsStore.getState().dependents,
    accounts: useAccountsStore.getState().accounts,
    holdings: useHoldingsStore.getState().holdings,
    contributions: useContributionsStore.getState().contributions,
    account_snapshots: useSnapshotsStore.getState().snapshots,
    loans: useLoansStore.getState().loans,
    loan_payments: useLoanPaymentsStore.getState().payments,
    properties: usePropertiesStore.getState().properties,
    vehicles: useVehiclesStore.getState().vehicles,
    equity_grants: useEquityGrantsStore.getState().equityGrants,
    goals: useGoalsStore.getState().goals,
  };
}

/**
 * Trigger a browser download for the given JSON string.
 * Uses a Blob + temporary anchor; the URL is revoked immediately after
 * the synthetic click to free memory.
 */
function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Stub: the destructive half of restore.
 *
 * TODO(phase-3-followup): wire this up properly. To do so we need
 * `deleteAll()` (or the equivalent transactional truncate) on every domain
 * repo:
 *   - HouseholdRepo, PersonsRepo, DependentsRepo, AccountsRepo,
 *     HoldingsRepo, ContributionsRepo, AccountSnapshotsRepo, LoansRepo,
 *     LoanPaymentsRepo, PropertiesRepo, VehiclesRepo
 *
 * The applyBackup flow then becomes:
 *   1. BEGIN TRANSACTION
 *   2. await Promise.all(repos.map(r => r.deleteAll()))
 *   3. for each table in dependency order, repo.create(row) per backup row
 *   4. COMMIT (rollback on any failure)
 *   5. await Promise.all(stores.map(s => s.load()))
 *
 * Until that scaffolding lands we deliberately do nothing: a half-completed
 * restore would corrupt the user's data far worse than no restore at all.
 * The export side is fully functional in the meantime, which is the side
 * users need most.
 */
async function applyBackup(_backup: Backup): Promise<void> {
  console.warn(
    'DataSection: applyBackup is stubbed pending deleteAll() additions ' +
      'to every domain repo. The backup file was validated successfully but ' +
      'no data was modified. See applyBackup() in DataSection.tsx.',
  );
}

export function DataSection() {
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<Backup | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-clear the inline status messages after a few seconds so the section
  // doesn't accumulate stale notices across multiple actions.
  useEffect(() => {
    if (!exportMessage) return;
    const t = setTimeout(() => setExportMessage(null), 4000);
    return () => clearTimeout(t);
  }, [exportMessage]);
  useEffect(() => {
    if (!restoreSuccess) return;
    const t = setTimeout(() => setRestoreSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [restoreSuccess]);

  function handleExport() {
    try {
      const data = snapshotStores();
      const json = serializeBackup(data);
      const filename = `finance-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, json);
      setExportMessage('Exported backup successfully.');
    } catch (e) {
      setExportMessage(
        `Export failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // handleRestoreClick removed (R5) — the Restore button is disabled in v1
  // pending a real applyBackup implementation. The file-input + handlers
  // below remain so re-enabling later is a one-line button change.

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be chosen again later.
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const backup = deserializeBackup(text);
      setPendingRestore(backup);
      setConfirmingRestore(true);
    } catch (e) {
      setPendingRestore(null);
      setConfirmingRestore(false);
      setRestoreError(
        `Invalid backup file: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function handleConfirmRestore() {
    if (!pendingRestore) {
      setConfirmingRestore(false);
      return;
    }
    try {
      await applyBackup(pendingRestore);
      setRestoreSuccess('Restore completed (stubbed — see commit message).');
    } catch (e) {
      setRestoreError(
        `Restore failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setConfirmingRestore(false);
      setPendingRestore(null);
    }
  }

  function handleCancelRestore() {
    setConfirmingRestore(false);
    setPendingRestore(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Export your entire dataset to a JSON file you can store anywhere, or
          restore from a previous backup. Backups are saved to your downloads
          folder by your browser.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Export</h3>
            <p className="text-sm text-muted-foreground">
              Download a JSON file containing every household, person,
              account, holding, snapshot, loan, property, and vehicle in
              your local database.
            </p>
            <Button onClick={handleExport}>Export to JSON</Button>
            {exportMessage && (
              <p
                className="text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {exportMessage}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Restore</h3>
            <p className="text-sm text-muted-foreground">
              Restore from a previous backup file. Currently disabled —
              only Export works in v1.
            </p>
            <Button
              variant="outline"
              disabled
              aria-disabled="true"
              data-testid="restore-button-disabled"
              title="Restore is not yet implemented — only Export works in v1"
            >
              Restore from JSON
            </Button>
            <p
              className="text-xs text-muted-foreground"
              data-testid="restore-not-implemented-hint"
            >
              Restore is not yet implemented — only Export works in v1.
              Export your data periodically; importing back to the app will
              ship in a later release.
            </p>
            {/*
              The hidden file input + restoreError/restoreSuccess state are
              left in place so the future "real Restore" can re-enable the
              button without re-wiring the plumbing. The handlers below are
              dormant while the button is disabled.
            */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileChange}
              aria-label="Backup file"
            />
            {restoreError && (
              <p className="text-sm text-destructive" role="alert">
                {restoreError}
              </p>
            )}
            {restoreSuccess && (
              <p
                className="text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {restoreSuccess}
              </p>
            )}
          </div>
        </div>
      </CardContent>

      {confirmingRestore && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-background rounded-md border shadow-lg p-6 max-w-md w-full mx-4">
            <h2
              id="restore-confirm-title"
              className="text-lg font-semibold mb-2"
            >
              Replace all data?
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              This will replace all your current data with the backup. This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={handleCancelRestore}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmRestore}>
                Restore
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
