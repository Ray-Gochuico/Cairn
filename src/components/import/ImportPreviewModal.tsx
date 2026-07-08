import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  createImportPreviewStore,
  type ImportPreviewState,
  type ParseResultLite,
} from '@/stores/import-preview-store';
import { ImportPreviewTable } from './ImportPreviewTable';
import { TransactionPreviewTable } from './TransactionPreviewTable';
import { AccountPreviewTable } from './AccountPreviewTable';
import { HoldingPreviewTable } from './HoldingPreviewTable';
import { LoanPreviewTable } from './LoanPreviewTable';
import { PropertyPreviewTable } from './PropertyPreviewTable';
import { VehiclePreviewTable } from './VehiclePreviewTable';
import { ContributionPreviewTable } from './ContributionPreviewTable';
import { AssetValueSnapshotPreviewTable } from './AssetValueSnapshotPreviewTable';
import { EquityGrantPreviewTable } from './EquityGrantPreviewTable';
import { commitSnapshotImport, commitTransactionImport } from '@/lib/import/commit';
import { commitAccountImport } from '@/lib/import/commit/account';
import { commitHoldingImport } from '@/lib/import/commit/holding';
import { commitLoanImport } from '@/lib/import/commit/loan';
import { commitPropertyImport } from '@/lib/import/commit/property';
import { commitVehicleImport } from '@/lib/import/commit/vehicle';
import { commitContributionImport } from '@/lib/import/commit/contribution';
import { commitAssetValueSnapshotImport } from '@/lib/import/commit/asset-value-snapshot';
import { commitEquityGrantImport } from '@/lib/import/commit/equity-grant';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useHouseholdStore } from '@/stores/household-store';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { TransactionsRepo } from '@/domain/transactions';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { LoansRepo } from '@/domain/loans';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import { ContributionsRepo } from '@/domain/contributions';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { getDatabase } from '@/db/db';
import type { ImportEntity, ValidationContext, CommitResult } from '@/lib/import/types';

interface Props {
  entity: ImportEntity;
  parsed: ParseResultLite;
  ctx: ValidationContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown as "File {current} of {total}" subtitle when total > 1. Omit for single-file callers. */
  queuePosition?: { current: number; total: number };
  /**
   * Number of files still in the queue (including the one being previewed).
   * When > 1 the footer splits the dismiss control into "Skip this file"
   * (advances via onOpenChange(false)) and "Cancel all N files" (onCancelAll),
   * so cancelling file 1 never silently drops files 2..N (M4).
   */
  queueLength?: number;
  /**
   * Drops the entire remaining batch. Only surfaced (as "Cancel all") when
   * queueLength > 1. Distinct from onOpenChange(false), which now means
   * "skip just this file" in a batch.
   */
  onCancelAll?: () => void;
  /**
   * Called after a successful import. Receives the row count just inserted.
   * When provided, the modal does NOT auto-close — the caller is in charge
   * of advancing or closing (used by the multi-file queue to advance to the
   * next file without flicker). When absent, the modal auto-closes via
   * `onOpenChange(false)` as today.
   */
  onSaved?: (insertedCount: number) => void;
}

const ENTITY_TITLES: Record<ImportEntity, string> = {
  snapshot: 'Import account snapshots from CSV',
  transaction: 'Import transactions from CSV',
  account: 'Import accounts from CSV',
  holding: 'Import holdings from CSV',
  loan: 'Import loans from CSV',
  property: 'Import properties from CSV',
  vehicle: 'Import vehicles from CSV',
  equity_grant: 'Import equity grants from CSV',
  contribution: 'Import contributions from CSV',
  asset_value_snapshot: 'Import asset value snapshots from CSV',
};

export function ImportPreviewModal({
  entity,
  parsed,
  ctx,
  open,
  onOpenChange,
  queuePosition,
  queueLength,
  onCancelAll,
  onSaved,
}: Props) {
  const storeRef = useMemo(
    () => createImportPreviewStore(entity, parsed, ctx),
    [entity, parsed, ctx],
  );
  const state = useStore(storeRef);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const loadAccounts = useAccountsStore((s) => s.load);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const loadLoans = useLoansStore((s) => s.load);
  const loadProperties = usePropertiesStore((s) => s.load);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const loadContributions = useContributionsStore((s) => s.load);
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);
  const loadEquityGrants = useEquityGrantsStore((s) => s.load);
  const household = useHouseholdStore((s) => s.household);

  const commitDisabled =
    state.summary.error > 0
    || state.committableRows().length === 0
    || committing;

  const onCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const db = getDatabase();
      const householdId = household?.id ?? 1;
      let result: CommitResult | undefined;
      let insertedCount = 0;
      const rows = state.committableRows();

      switch (entity) {
        case 'snapshot': {
          result = await commitSnapshotImport(rows as any, {
            db,
            snapshots: new AccountSnapshotsRepo(db),
          });
          await loadSnapshots();
          break;
        }
        case 'transaction': {
          result = await commitTransactionImport(rows as any, {
            db,
            transactions: new TransactionsRepo(db),
            householdId,
          });
          await loadTransactions();
          break;
        }
        case 'account': {
          result = await commitAccountImport(rows as any, {
            db,
            accounts: new AccountsRepo(db),
            householdId,
          });
          await loadAccounts();
          break;
        }
        case 'holding': {
          result = await commitHoldingImport(rows as any, {
            db,
            holdings: new HoldingsRepo(db),
          });
          await loadHoldings();
          break;
        }
        case 'loan': {
          result = await commitLoanImport(rows as any, {
            db,
            loans: new LoansRepo(db),
            householdId,
          });
          await loadLoans();
          break;
        }
        case 'property': {
          result = await commitPropertyImport(rows as any, {
            db,
            properties: new PropertiesRepo(db),
            assetValueSnapshots: new AssetValueSnapshotsRepo(db),
            householdId,
            todayIso: new Date().toISOString().slice(0, 10),
          });
          await loadProperties();
          // A value change may have minted a snapshot — refeed its store so
          // charts/value-history reflect it without an app reload.
          await loadAssetValueSnapshots();
          break;
        }
        case 'vehicle': {
          result = await commitVehicleImport(rows as any, {
            db,
            vehicles: new VehiclesRepo(db),
            assetValueSnapshots: new AssetValueSnapshotsRepo(db),
            householdId,
            todayIso: new Date().toISOString().slice(0, 10),
          });
          await loadVehicles();
          // A value change may have minted a snapshot — refeed its store so
          // charts/value-history reflect it without an app reload.
          await loadAssetValueSnapshots();
          break;
        }
        case 'contribution': {
          result = await commitContributionImport(rows as any, {
            db,
            contributions: new ContributionsRepo(db),
          });
          await loadContributions();
          break;
        }
        case 'asset_value_snapshot': {
          result = await commitAssetValueSnapshotImport(rows as any, {
            db,
            assetValueSnapshots: new AssetValueSnapshotsRepo(db),
          });
          await loadAssetValueSnapshots();
          break;
        }
        case 'equity_grant': {
          result = await commitEquityGrantImport(rows as any, {
            db,
            equityGrants: new EquityGrantsRepo(db),
            householdId,
          });
          await loadEquityGrants();
          break;
        }
      }
      insertedCount = (result?.inserted ?? 0) + (result?.updated ?? 0);
      if (insertedCount === 0) {
        insertedCount = rows.length;
      }
      if (onSaved) {
        onSaved(insertedCount);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const title = ENTITY_TITLES[entity] ?? 'Import from CSV';
  const committableCount = state.committableRows().length;

  const previewTable = (() => {
    switch (entity) {
      case 'snapshot':
        return <ImportPreviewTable state={state as unknown as ImportPreviewState<'snapshot'>} />;
      case 'transaction':
        return <TransactionPreviewTable state={state as unknown as ImportPreviewState<'transaction'>} />;
      case 'account':
        return <AccountPreviewTable state={state as unknown as ImportPreviewState<'account'>} />;
      case 'holding':
        return <HoldingPreviewTable state={state as unknown as ImportPreviewState<'holding'>} />;
      case 'loan':
        return <LoanPreviewTable state={state as unknown as ImportPreviewState<'loan'>} />;
      case 'property':
        return <PropertyPreviewTable state={state as unknown as ImportPreviewState<'property'>} />;
      case 'vehicle':
        return <VehiclePreviewTable state={state as unknown as ImportPreviewState<'vehicle'>} />;
      case 'contribution':
        return <ContributionPreviewTable state={state as unknown as ImportPreviewState<'contribution'>} />;
      case 'asset_value_snapshot':
        return <AssetValueSnapshotPreviewTable state={state as unknown as ImportPreviewState<'asset_value_snapshot'>} />;
      case 'equity_grant':
        return <EquityGrantPreviewTable state={state as unknown as ImportPreviewState<'equity_grant'>} />;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {/* Wave-4 a11y: status span announces batch advancement as the
                modal re-renders for each queued file. */}
            {queuePosition && queuePosition.total > 1 ? (
              <span role="status">
                File {queuePosition.current} of {queuePosition.total} ·{' '}
              </span>
            ) : null}
            {parsed.rows.length} rows parsed
            {parsed.errors.length > 0 && (
              <span className="text-destructive-soft-foreground ml-2">
                · {parsed.errors.length} lines could not be parsed
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {parsed.errors.length > 0 && (
          <div className="text-xs text-destructive-soft-foreground italic bg-destructive/10 border border-destructive/30 rounded p-2">
            {parsed.errors.length} lines could not be parsed (line{' '}
            {/* Cap the inline line list (L3): a badly malformed large CSV could
                otherwise dump thousands of line numbers into the header. */}
            {parsed.errors.slice(0, 10).map((e) => e.line).join(', ')}
            {parsed.errors.length > 10
              ? `, and ${parsed.errors.length - 10} more`
              : ''}
            ). Fix and re-upload.
          </div>
        )}

        <SummaryBar
          state={state as unknown as ImportPreviewState<ImportEntity>}
          entity={entity}
        />
        {/* The virtualized preview table owns its own bounded scroll parent
            (max-h-[55vh] overflow-auto) so the virtualizer can measure a finite
            viewport; an outer scroll wrapper here would nest two scrollers and
            defeat the windowing. The empty-state path has no scroll and renders
            fine inside this plain container. */}
        <div>{previewTable}</div>

        {commitError && (
          <div className="text-xs text-destructive-soft-foreground italic bg-destructive/10 border border-destructive/30 rounded p-2">
            Commit failed: {commitError}
          </div>
        )}

        <DialogFooter>
          {state.summary.error > 0 && (
            <div className="text-xs text-destructive-soft-foreground mr-auto self-center">
              Resolve {state.summary.error} error
              {state.summary.error === 1 ? '' : 's'} before committing
            </div>
          )}
          {queueLength && queueLength > 1 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Skip this file
              </Button>
              <Button
                variant="ghost"
                className="text-destructive-soft-foreground"
                onClick={() => onCancelAll?.()}
              >
                Cancel all {queueLength} files
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          <Button disabled={commitDisabled} onClick={onCommit}>
            {committing ? 'Committing…' : `Commit (${committableCount} rows)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryBar({
  state,
  entity,
}: {
  state: ImportPreviewState<ImportEntity>;
  entity: ImportEntity;
}) {
  return (
    <div className="flex gap-2 items-center text-xs flex-wrap">
      <span className="bg-success-soft text-success-foreground px-2 py-0.5 rounded-full">
        {state.summary.new} new
      </span>
      {state.summary.update > 0 && (
        <span className="bg-warning-soft text-warning-foreground px-2 py-0.5 rounded-full">
          {state.summary.update} update
        </span>
      )}
      {state.summary.duplicate > 0 && (
        <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
          {state.summary.duplicate} duplicate
        </span>
      )}
      <span className="bg-destructive/15 text-destructive-soft-foreground px-2 py-0.5 rounded-full">
        {state.summary.error} error{state.summary.error === 1 ? '' : 's'}
      </span>
      <div className="ml-auto flex gap-2">
        {entity === 'snapshot' && (
          <>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('update')}>
              Update all
            </Button>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('skip')}>
              Skip all
            </Button>
          </>
        )}
        {(entity === 'transaction' || entity === 'contribution') && state.summary.duplicate > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('update')}>
              Insert all duplicates
            </Button>
            <Button size="sm" variant="outline" onClick={() => state.bulkSetConflict('skip')}>
              Skip all duplicates
            </Button>
          </>
        )}
        {state.summary.error > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive-soft-foreground"
            onClick={() => state.deleteAllErrors()}
          >
            Delete errors
          </Button>
        )}
      </div>
    </div>
  );
}
