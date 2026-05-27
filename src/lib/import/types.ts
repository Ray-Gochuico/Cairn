// src/lib/import/types.ts
import type {
  Account,
  Holding,
  Loan,
  Property,
  Vehicle,
  EquityGrant,
  AssetValueSnapshot,
} from '@/types/schema';

/**
 * Row identity inside a single import session.
 * Stable across user edits — derived from the row's index in the
 * originally-parsed `rawRows` array.
 */
export type RowId = number;

/**
 * One row as parsed from the CSV file, keyed by the header value.
 * Always strings — type coercion happens during validation.
 */
export type RawRow = Record<string, string>;

/**
 * Per-cell validation error. `field` is the CSV header name; `message`
 * is a short human-readable explanation displayed in the preview modal.
 */
export interface CellError {
  field: string;
  message: string;
}

/**
 * Validator status for a single row.
 * - 'new'       : will INSERT
 * - 'update'    : will UPDATE an existing row (UNIQUE conflict for snapshots)
 * - 'duplicate' : matches an existing row by dedupe heuristic (transactions only)
 * - 'error'     : has at least one CellError; not committable
 */
export type PreviewStatus = 'new' | 'update' | 'duplicate' | 'error';

/**
 * The resolved + validated row carried through the preview modal.
 * `raw` is the unmodified parsed CSV row; `resolved` is the typed,
 * cleaned shape ready to write to the DB (or `undefined` if validation
 * failed for that field).
 */
export interface PreviewRow<TResolved = unknown> {
  rowId: RowId;
  raw: RawRow;
  resolved: TResolved;
  status: PreviewStatus;
  errors: CellError[];
  /** For UPDATE/DUPLICATE: the existing DB row this conflicts with. */
  existing?: unknown;
  /** For UPDATE: the id of the existing row this conflicts with. */
  existingId?: number;
}

/**
 * Which entity is being imported. Drives validator selection and the
 * commit path.
 */
export type ImportEntity =
  | 'snapshot'
  | 'transaction'
  | 'account'
  | 'holding'
  | 'loan'
  | 'property'
  | 'vehicle'
  | 'equity_grant'
  | 'contribution'
  | 'asset_value_snapshot';

/**
 * The result of a successful commit batch.
 */
export interface CommitResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Shared context passed to validators. Assembled once per import session
 * by Sub-Plan B's modal store; validators never reach for stores.
 */
export interface ValidationContext {
  accounts: ReadonlyArray<{ id: number; name: string }>;
  persons?: ReadonlyArray<{ id: number; name: string }>;
  categories?: ReadonlyArray<{ id: number; name: string }>;
  /** Properties pool for FK resolution (loans linked-property, asset-value-snapshot owner). */
  properties?: ReadonlyArray<{ id: number; name: string }>;
  /** Vehicles pool for FK resolution (loans linked-vehicle, asset-value-snapshot owner). */
  vehicles?: ReadonlyArray<{ id: number; name: string }>;
  /** Map of existing snapshots: `${accountId}|${YYYY-MM-DD}` → totalValue */
  existingSnapshots?: ReadonlyMap<string, number>;
  /** Existing transactions keyed by `${accountId}|${date}|${amount}|${lowercased+trimmed merchant}` */
  existingTransactionKeys?: ReadonlySet<string>;

  /** NEW — per-entity conflict maps for N2 entities. */
  existingAccountConflicts?: ReadonlyMap<string, Account>;
  existingHoldingConflicts?: ReadonlyMap<string, Holding>;
  existingLoanConflicts?: ReadonlyMap<string, Loan>;
  existingPropertyConflicts?: ReadonlyMap<string, Property>;
  existingVehicleConflicts?: ReadonlyMap<string, Vehicle>;
  existingEquityGrantConflicts?: ReadonlyMap<string, EquityGrant>;
  existingContributionDupKeys?: ReadonlySet<string>;
  existingAssetValueSnapshotConflicts?: ReadonlyMap<string, AssetValueSnapshot>;
}
