// src/stores/import-preview-store.ts
import { createStore } from 'zustand/vanilla';
import type { PreviewRow, RawRow, RowId, ValidationContext, ImportEntity, PreviewStatus } from '@/lib/import/types';
import { validateSnapshotRow, type SnapshotResolved } from '@/lib/import/validators/snapshot-validator';
import { validateTransactionRow, type TransactionResolved } from '@/lib/import/validators/transaction-validator';
import { validateAccountRow, type AccountResolved } from '@/lib/import/validators/account';
import { validateHoldingRow, type HoldingResolved } from '@/lib/import/validators/holding';
import { validateLoanRow, type LoanResolved } from '@/lib/import/validators/loan';
import { validatePropertyRow, type PropertyResolved } from '@/lib/import/validators/property';
import { validateVehicleRow, type VehicleResolved } from '@/lib/import/validators/vehicle';
import { validateContributionRow, type ContributionResolved } from '@/lib/import/validators/contribution';
import { validateAssetValueSnapshotRow, type AssetValueSnapshotResolved } from '@/lib/import/validators/asset-value-snapshot';
import { validateEquityGrantRow, type EquityGrantResolved } from '@/lib/import/validators/equity-grant';

export interface ParseResultLite {
  headers: string[];
  rows: ReadonlyArray<RawRow>;
  errors: Array<{ line: number; message: string }>;
}

// ResolvedFor maps each ImportEntity to its validator's resolved payload
// type. The mapped-conditional approach keeps the type per-call narrow so
// e.g. `ImportPreviewState<'account'>` exposes AccountResolved-shaped rows.
// Entities whose validators land in later N2 tasks fall back to `unknown`
// here and are tightened when those validators get imported in δ1.
type ResolvedFor<E extends ImportEntity> =
  E extends 'snapshot' ? SnapshotResolved :
  E extends 'transaction' ? TransactionResolved :
  E extends 'account' ? AccountResolved :
  E extends 'holding' ? HoldingResolved :
  E extends 'loan' ? LoanResolved :
  E extends 'property' ? PropertyResolved :
  E extends 'vehicle' ? VehicleResolved :
  E extends 'contribution' ? ContributionResolved :
  E extends 'asset_value_snapshot' ? AssetValueSnapshotResolved :
  E extends 'equity_grant' ? EquityGrantResolved :
  unknown;

interface ImportSummary {
  new: number;
  update: number;
  duplicate: number;
  error: number;
  deleted: number;
}

export interface ImportPreviewState<E extends ImportEntity> {
  entity: E;
  headers: string[];
  rawRows: ReadonlyArray<RawRow>;
  edits: Map<RowId, RawRow>;
  deletions: Set<RowId>;
  conflictMode: Map<RowId, 'update' | 'skip'>;
  ctx: ValidationContext;
  derivedRows: PreviewRow<ResolvedFor<E>>[];
  summary: ImportSummary;

  edit(rowId: RowId, patch: RawRow): void;
  delete(rowId: RowId): void;
  bulkSetConflict(mode: 'update' | 'skip'): void;
  setConflictMode(rowId: RowId, mode: 'update' | 'skip'): void;
  deleteAllErrors(): void;
  /**
   * v1.8.0 O1 (CR-O-2): take a new validation context (Flip signs, or the
   * stores behind it reloaded) without starting the preview over. Every edit,
   * deletion and conflict choice is kept; every row is checked again against
   * the new context. The same context object again is a no-op.
   */
  setCtx(ctx: ValidationContext): void;
  committableRows(): PreviewRow<ResolvedFor<E>>[];
}

type AnyValidator = (raw: RawRow, rowId: RowId, ctx: ValidationContext) => PreviewRow<unknown>;

function selectValidator(entity: ImportEntity): AnyValidator {
  switch (entity) {
    case 'snapshot':    return validateSnapshotRow as unknown as AnyValidator;
    case 'transaction': return validateTransactionRow as unknown as AnyValidator;
    case 'account':     return validateAccountRow as unknown as AnyValidator;
    case 'holding':     return validateHoldingRow as unknown as AnyValidator;
    case 'loan':        return validateLoanRow as unknown as AnyValidator;
    case 'property':    return validatePropertyRow as unknown as AnyValidator;
    case 'vehicle':     return validateVehicleRow as unknown as AnyValidator;
    case 'contribution': return validateContributionRow as unknown as AnyValidator;
    case 'asset_value_snapshot': return validateAssetValueSnapshotRow as unknown as AnyValidator;
    case 'equity_grant': return validateEquityGrantRow as unknown as AnyValidator;
  }
}

/**
 * Per-row identity cache entry. `sig` is a content signature of the merged
 * raw input; `row` is the validated PreviewRow we produced for it.
 */
interface RowCacheEntry {
  sig: string;
  row: PreviewRow<unknown>;
}

function deriveRows<E extends ImportEntity>(
  entity: E,
  rawRows: ReadonlyArray<RawRow>,
  edits: Map<RowId, RawRow>,
  deletions: Set<RowId>,
  ctx: ValidationContext,
  // Identity cache from the previous derive. Validators are pure functions of
  // (merged, rowId, ctx) and ctx changes only through setCtx, which drops the
  // cache, so a row whose merged input signature is unchanged yields a
  // byte-identical PreviewRow — we reuse the prior object so its reference is
  // stable. Without this, every edit re-derives ALL rows into fresh objects
  // and the per-row React.memo in the preview tables can never skip an
  // unrelated row (a 10k-row import would re-render all 10k rows on each
  // keystroke). `prevCache` is read and the fresh cache is written in place.
  prevCache?: Map<RowId, RowCacheEntry>,
  nextCache?: Map<RowId, RowCacheEntry>,
): { derivedRows: PreviewRow<ResolvedFor<E>>[]; summary: ImportSummary } {
  const validator = selectValidator(entity);
  const derivedRows: PreviewRow<ResolvedFor<E>>[] = [];
  let nNew = 0, nUpdate = 0, nError = 0, nDup = 0;
  for (let i = 0; i < rawRows.length; i++) {
    if (deletions.has(i)) continue;
    const merged: RawRow = { ...rawRows[i], ...(edits.get(i) ?? {}) };
    const sig = JSON.stringify(merged);
    const cached = prevCache?.get(i);
    let row: PreviewRow<ResolvedFor<E>>;
    if (cached && cached.sig === sig) {
      row = cached.row as PreviewRow<ResolvedFor<E>>;
    } else {
      row = validator(merged, i, ctx) as PreviewRow<ResolvedFor<E>>;
    }
    nextCache?.set(i, { sig, row });
    derivedRows.push(row);
    switch (row.status as PreviewStatus) {
      case 'new': nNew++; break;
      case 'update': nUpdate++; break;
      case 'error': nError++; break;
      case 'duplicate': nDup++; break;
    }
  }
  return {
    derivedRows,
    summary: { new: nNew, update: nUpdate, error: nError, duplicate: nDup, deleted: deletions.size },
  };
}

export function createImportPreviewStore<E extends ImportEntity>(
  entity: E,
  parsed: ParseResultLite,
  ctx: ValidationContext,
) {
  return createStore<ImportPreviewState<E>>((set, get) => {
    const initialEdits = new Map<RowId, RawRow>();
    const initialDeletions = new Set<RowId>();
    // Persistent per-row identity cache (see deriveRows). Lives for the whole
    // import session (setCtx starts it over) so unchanged rows keep a stable
    // PreviewRow reference across every edit, letting the per-row React.memo
    // skip them.
    let rowCache = new Map<RowId, RowCacheEntry>();
    const { derivedRows, summary } = deriveRows(
      entity, parsed.rows, initialEdits, initialDeletions, ctx, undefined, rowCache,
    );
    // v1.8.0 W4 (O1 chip (j) ⚑): Skip all (and Skip all duplicates) also
    // covers a row that turns into a conflict after it was pressed (an edit,
    // or a reload pushed in through setCtx), unless the row has a choice of
    // its own. Only a skip carries forward: Update all and Insert all
    // duplicates act on the rows shown at the click, so a duplicate that
    // appears later is never written without a choice of its own, and either
    // of them ends an earlier Skip all's carry.
    let bulkConflict: 'skip' | null = null;
    const withBulkConflict = (
      conflictMode: Map<RowId, 'update' | 'skip'>,
      rows: ReadonlyArray<PreviewRow<unknown>>,
    ): Map<RowId, 'update' | 'skip'> => {
      if (bulkConflict === null) return conflictMode;
      let out = conflictMode;
      for (const r of rows) {
        if ((r.status === 'update' || r.status === 'duplicate') && !out.has(r.rowId)) {
          if (out === conflictMode) out = new Map(conflictMode);
          out.set(r.rowId, bulkConflict);
        }
      }
      return out;
    };

    const recompute = (s: ImportPreviewState<E>): ImportPreviewState<E> => {
      const nextCache = new Map<RowId, RowCacheEntry>();
      const next = deriveRows(
        entity, s.rawRows, s.edits, s.deletions, s.ctx, rowCache, nextCache,
      );
      rowCache = nextCache;
      return {
        ...s,
        derivedRows: next.derivedRows,
        summary: next.summary,
        conflictMode: withBulkConflict(s.conflictMode, next.derivedRows),
      };
    };

    return {
      entity,
      headers: parsed.headers,
      rawRows: parsed.rows,
      edits: initialEdits,
      deletions: initialDeletions,
      conflictMode: new Map(),
      ctx,
      derivedRows,
      summary,

      edit: (rowId, patch) => set((s) => {
        const edits = new Map(s.edits);
        edits.set(rowId, { ...(edits.get(rowId) ?? {}), ...patch });
        return recompute({ ...s, edits });
      }),

      delete: (rowId) => set((s) => {
        const deletions = new Set(s.deletions);
        deletions.add(rowId);
        return recompute({ ...s, deletions });
      }),

      bulkSetConflict: (mode) => set((s) => {
        bulkConflict = mode === 'skip' ? 'skip' : null;
        const conflictMode = new Map(s.conflictMode);
        for (const r of s.derivedRows) {
          if (r.status === 'update' || r.status === 'duplicate') {
            conflictMode.set(r.rowId, mode);
          }
        }
        return { ...s, conflictMode };
      }),

      setConflictMode: (rowId, mode) => set((s) => {
        const conflictMode = new Map(s.conflictMode);
        conflictMode.set(rowId, mode);
        return { ...s, conflictMode };
      }),

      deleteAllErrors: () => set((s) => {
        const deletions = new Set(s.deletions);
        for (const r of s.derivedRows) {
          if (r.status === 'error') deletions.add(r.rowId);
        }
        return recompute({ ...s, deletions });
      }),

      setCtx: (nextCtx) => set((s) => {
        if (s.ctx === nextCtx) return s;
        // A new context can change any row's verdict (account names, the
        // rows that already exist, the amount sign), so nothing checked under
        // the old one is reused. edits, deletions and conflictMode carry over.
        rowCache = new Map();
        return recompute({ ...s, ctx: nextCtx });
      }),

      committableRows: () => {
        const s = get();
        return s.derivedRows.filter((r) => {
          if (r.status === 'error') return false;
          if (r.status === 'duplicate') {
            const mode = s.conflictMode.get(r.rowId) ?? 'skip';
            return mode !== 'skip';
          }
          if (r.status === 'update') {
            const mode = s.conflictMode.get(r.rowId) ?? 'update';
            return mode !== 'skip';
          }
          return true;
        });
      },
    };
  });
}
