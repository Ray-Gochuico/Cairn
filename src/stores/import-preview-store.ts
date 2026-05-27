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
    // Remaining entities wired in δ1 as their validators land.
    default:
      throw new Error(`No validator registered for entity "${entity}"`);
  }
}

function deriveRows<E extends ImportEntity>(
  entity: E,
  rawRows: ReadonlyArray<RawRow>,
  edits: Map<RowId, RawRow>,
  deletions: Set<RowId>,
  ctx: ValidationContext,
): { derivedRows: PreviewRow<ResolvedFor<E>>[]; summary: ImportSummary } {
  const validator = selectValidator(entity);
  const derivedRows: PreviewRow<ResolvedFor<E>>[] = [];
  let nNew = 0, nUpdate = 0, nError = 0, nDup = 0;
  for (let i = 0; i < rawRows.length; i++) {
    if (deletions.has(i)) continue;
    const merged: RawRow = { ...rawRows[i], ...(edits.get(i) ?? {}) };
    const row = validator(merged, i, ctx) as PreviewRow<ResolvedFor<E>>;
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
    const { derivedRows, summary } = deriveRows(entity, parsed.rows, initialEdits, initialDeletions, ctx);

    const recompute = (s: ImportPreviewState<E>): ImportPreviewState<E> => {
      const next = deriveRows(entity, s.rawRows, s.edits, s.deletions, s.ctx);
      return { ...s, derivedRows: next.derivedRows, summary: next.summary };
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
