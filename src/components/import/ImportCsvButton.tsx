import { useRef, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { parseCsv, type ParseResult } from '@/lib/import/parse-csv';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import {
  buildSnapshotConflictMap,
  buildTransactionDuplicateKeys,
  buildAccountConflictMap,
  buildHoldingConflictMap,
  buildLoanConflictMap,
  buildPropertyConflictMap,
  buildVehicleConflictMap,
  buildEquityGrantConflictMap,
  buildContributionDuplicateKeys,
  buildAssetValueSnapshotConflictMap,
} from '@/lib/import/conflict-detector';
import { downloadCsv } from '@/lib/csv';
import { accountTemplateCsv } from '@/lib/import/validators/account';
import { holdingTemplateCsv } from '@/lib/import/validators/holding';
import { loanTemplateCsv } from '@/lib/import/validators/loan';
import { propertyTemplateCsv } from '@/lib/import/validators/property';
import { vehicleTemplateCsv } from '@/lib/import/validators/vehicle';
import { equityGrantTemplateCsv } from '@/lib/import/validators/equity-grant';
import { contributionTemplateCsv } from '@/lib/import/validators/contribution';
import { assetValueSnapshotTemplateCsv } from '@/lib/import/validators/asset-value-snapshot';
import type { ImportEntity, ValidationContext } from '@/lib/import/types';

const ENTITY_LABEL: Record<ImportEntity, string> = {
  snapshot: 'snapshot',
  transaction: 'transaction',
  account: 'account',
  holding: 'holding',
  loan: 'loan',
  property: 'property',
  vehicle: 'vehicle',
  equity_grant: 'equity grant',
  contribution: 'contribution',
  asset_value_snapshot: 'asset value snapshot',
};

/**
 * Return the downloadable CSV template body for a given entity. Snapshot
 * and transaction templates are not provided yet (P1/P2's validators
 * never exposed a template helper) — the link is hidden for those.
 */
function getTemplateCsv(entity: ImportEntity): string | null {
  switch (entity) {
    case 'account': return accountTemplateCsv();
    case 'holding': return holdingTemplateCsv();
    case 'loan': return loanTemplateCsv();
    case 'property': return propertyTemplateCsv();
    case 'vehicle': return vehicleTemplateCsv();
    case 'equity_grant': return equityGrantTemplateCsv();
    case 'contribution': return contributionTemplateCsv();
    case 'asset_value_snapshot': return assetValueSnapshotTemplateCsv();
    case 'snapshot':
    case 'transaction':
      return null;
  }
}

interface Props {
  entity: ImportEntity;
}

interface PendingCsv {
  filename: string;
  parsed: ParseResult;
}

interface BatchImportError {
  filename: string;
  message: string;
}

export function ImportCsvButton({ entity }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<PendingCsv[]>([]);
  const [errors, setErrors] = useState<BatchImportError[]>([]);
  // totalRef tracks the size of the current batch for the "File N of M" subtitle.
  // It's a ref (not state) because we only need it for rendering math derived
  // from queue length — queue.length changes already drive the re-render.
  const totalRef = useRef<number>(0);

  const accounts = useAccountsStore((s) => s.accounts);
  const persons = usePersonsStore((s) => s.persons);
  const categories = useCategoriesStore((s) => s.categories);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const transactions = useTransactionsStore((s) => s.transactions);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loans = useLoansStore((s) => s.loans);
  const properties = usePropertiesStore((s) => s.properties);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const contributions = useContributionsStore((s) => s.contributions);
  const assetValueSnapshots = useAssetValueSnapshotsStore((s) => s.assetValueSnapshots);

  const ctx: ValidationContext = useMemo(() => ({
    accounts: accounts.map((a) => ({ id: a.id!, name: a.name })),
    persons: persons.map((p) => ({ id: p.id!, name: p.name })),
    categories: categories.map((c) => ({ id: c.id!, name: c.name })),
    properties: properties.map((p) => ({ id: p.id!, name: p.name })),
    vehicles: vehicles.map((v) => ({ id: v.id!, name: v.name })),
    existingSnapshots: entity === 'snapshot'
      ? buildSnapshotConflictMap(
          snapshots
            .filter((s) => s.accountId != null)
            .map((s) => ({
              accountId: s.accountId!,
              snapshotDate: s.snapshotDate,
              totalValue: s.totalValue,
            })),
        )
      : undefined,
    existingTransactionKeys: entity === 'transaction'
      ? buildTransactionDuplicateKeys(
          transactions
            .filter((t) => t.sourceAccountId != null)
            .map((t) => ({
              accountId: t.sourceAccountId!,
              date: t.date,
              amount: t.amount,
              merchant: t.merchant,
            })),
        )
      : undefined,
    existingAccountConflicts:
      entity === 'account' ? buildAccountConflictMap(accounts) : undefined,
    existingHoldingConflicts:
      entity === 'holding' ? buildHoldingConflictMap(holdings) : undefined,
    existingLoanConflicts:
      entity === 'loan' ? buildLoanConflictMap(loans) : undefined,
    existingPropertyConflicts:
      entity === 'property' ? buildPropertyConflictMap(properties) : undefined,
    existingVehicleConflicts:
      entity === 'vehicle' ? buildVehicleConflictMap(vehicles) : undefined,
    existingEquityGrantConflicts:
      entity === 'equity_grant' ? buildEquityGrantConflictMap(equityGrants) : undefined,
    existingContributionDupKeys:
      entity === 'contribution' ? buildContributionDuplicateKeys(contributions) : undefined,
    existingAssetValueSnapshotConflicts:
      entity === 'asset_value_snapshot'
        ? buildAssetValueSnapshotConflictMap(assetValueSnapshots)
        : undefined,
  }), [
    accounts,
    persons,
    categories,
    snapshots,
    transactions,
    holdings,
    loans,
    properties,
    vehicles,
    equityGrants,
    contributions,
    assetValueSnapshots,
    entity,
  ]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const next: PendingCsv[] = [];
    const newErrors: BatchImportError[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        next.push({ filename: file.name, parsed: parseCsv(text) });
      } catch (err) {
        newErrors.push({
          filename: file.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (next.length > 0) {
      setQueue((prev) => {
        const wasEmpty = prev.length === 0;
        const updated = [...prev, ...next];
        if (wasEmpty) totalRef.current = updated.length;
        else totalRef.current += next.length;
        return updated;
      });
    }
    if (newErrors.length > 0) setErrors((prev) => [...prev, ...newErrors]);
  }

  const current = queue[0];
  const position =
    current && totalRef.current > 1
      ? { current: totalRef.current - queue.length + 1, total: totalRef.current }
      : undefined;

  const advance = () => {
    setQueue((prev) => {
      const next = prev.slice(1);
      if (next.length === 0) totalRef.current = 0;
      return next;
    });
  };

  const dropAll = () => {
    setQueue([]);
    totalRef.current = 0;
  };

  const templateCsv = getTemplateCsv(entity);

  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          Import CSV
        </Button>
        {templateCsv && (
          <Button
            variant="link"
            size="sm"
            data-testid="download-template-link"
            onClick={() => downloadCsv(`${entity}-template.csv`, templateCsv)}
            className="text-xs h-auto p-0"
          >
            Download {ENTITY_LABEL[entity]} template ↓
          </Button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        data-testid="import-csv-file-input"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      {errors.length > 0 && (
        <div
          role="alert"
          data-testid="csv-parse-errors"
          className="mt-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs"
        >
          <div className="font-medium text-warning-foreground mb-1">
            Couldn&apos;t parse {errors.length} {errors.length === 1 ? 'file' : 'files'}:
          </div>
          <ul className="space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono">{e.filename}</span>: {e.message}
              </li>
            ))}
          </ul>
          <Button
            variant="link"
            size="sm"
            onClick={() => setErrors([])}
            className="mt-1 h-auto p-0"
          >
            Dismiss
          </Button>
        </div>
      )}
      {current && (
        <ImportPreviewModal
          entity={entity}
          parsed={current.parsed}
          ctx={ctx}
          open={true}
          onOpenChange={(o) => {
            if (!o) dropAll();
          }}
          queuePosition={position}
          onSaved={() => advance()}
        />
      )}
    </>
  );
}
