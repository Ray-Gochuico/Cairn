import type { ImportEntity } from '@/lib/import/types';

/** The stores whose lists feed an import preview's validation context. */
export type CtxSource =
  | 'accounts' | 'persons' | 'categories' | 'properties' | 'vehicles'
  | 'snapshots' | 'transactions' | 'holdings' | 'loans' | 'equityGrants'
  | 'contributions' | 'assetValueSnapshots';

/**
 * v1.8.0 W4 (O1 chip (e)): the stores each entity's validator and preview
 * table read. ImportCsvButton rebuilds the context — and an open preview
 * checks every row again (v1.8.0 O1) — only when one of these reloads, never
 * for an unrelated store. tests/lib/import/ctx-sources.test.ts reads the
 * validators and tables and fails when one reads a list that is not listed
 * here.
 */
export const CTX_SOURCES: Record<ImportEntity, ReadonlyArray<CtxSource>> = {
  snapshot: ['accounts', 'snapshots'],
  transaction: ['accounts', 'persons', 'categories', 'transactions'],
  account: ['persons', 'accounts'],
  holding: ['accounts', 'holdings'],
  loan: ['persons', 'properties', 'vehicles', 'loans'],
  property: ['persons', 'properties'],
  vehicle: ['persons', 'vehicles'],
  equity_grant: ['persons', 'equityGrants'],
  contribution: ['accounts', 'persons', 'contributions'],
  asset_value_snapshot: ['properties', 'vehicles', 'assetValueSnapshots'],
};
