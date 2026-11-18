/**
 * v1.8.0 W4 (O1 chip (e), folded in task_90fd839b): CTX_SOURCES, the stores
 * an import preview's context is rebuilt for, names every list each entity's
 * validator and preview table read. A list left out would leave an open
 * preview checked against a stale copy of it after a reload. Static: it reads
 * the source files. Clock-free.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CTX_SOURCES, type CtxSource } from '@/lib/import/ctx-sources';
import type { ImportEntity } from '@/lib/import/types';

describe('CTX_SOURCES names every list each entity reads (O1 (e))', () => {
  // Which store each ValidationContext field is built from (ImportCsvButton).
  const FIELD_SOURCE: Record<string, CtxSource | null> = {
    accounts: 'accounts',
    persons: 'persons',
    categories: 'categories',
    properties: 'properties',
    vehicles: 'vehicles',
    existingSnapshots: 'snapshots',
    existingTransactionKeys: 'transactions',
    existingAccountConflicts: 'accounts',
    existingHoldingConflicts: 'holdings',
    existingLoanConflicts: 'loans',
    existingPropertyConflicts: 'properties',
    existingVehicleConflicts: 'vehicles',
    existingEquityGrantConflicts: 'equityGrants',
    existingContributionDupKeys: 'contributions',
    existingAssetValueSnapshotConflicts: 'assetValueSnapshots',
    transactionAmountSign: null, // the preview's own Flip signs, not a store
  };
  const FILES: Record<ImportEntity, string[]> = {
    snapshot: ['src/lib/import/validators/snapshot-validator.ts', 'src/components/import/ImportPreviewTable.tsx'],
    transaction: ['src/lib/import/validators/transaction-validator.ts', 'src/components/import/TransactionPreviewTable.tsx'],
    account: ['src/lib/import/validators/account.ts', 'src/components/import/AccountPreviewTable.tsx'],
    holding: ['src/lib/import/validators/holding.ts', 'src/components/import/HoldingPreviewTable.tsx'],
    loan: ['src/lib/import/validators/loan.ts', 'src/components/import/LoanPreviewTable.tsx'],
    property: ['src/lib/import/validators/property.ts', 'src/components/import/PropertyPreviewTable.tsx'],
    vehicle: ['src/lib/import/validators/vehicle.ts', 'src/components/import/VehiclePreviewTable.tsx'],
    equity_grant: ['src/lib/import/validators/equity-grant.ts', 'src/components/import/EquityGrantPreviewTable.tsx'],
    contribution: ['src/lib/import/validators/contribution.ts', 'src/components/import/ContributionPreviewTable.tsx'],
    asset_value_snapshot: ['src/lib/import/validators/asset-value-snapshot.ts', 'src/components/import/AssetValueSnapshotPreviewTable.tsx'],
  };

  it.each(Object.keys(FILES) as ImportEntity[])('%s', (entity) => {
    const read = new Set<string>();
    for (const file of FILES[entity]) {
      const src = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
      for (const m of src.matchAll(/\bctx\.(\w+)/g)) read.add(m[1]);
    }
    expect(read.size).toBeGreaterThan(0);
    for (const field of read) {
      expect(field in FIELD_SOURCE, `${entity} reads ctx.${field}, which this test does not know`).toBe(true);
      const source = FIELD_SOURCE[field];
      if (source === null) continue;
      expect(CTX_SOURCES[entity], `${entity} reads ctx.${field} (the ${source} store)`).toContain(source);
    }
  });
});
