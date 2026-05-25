// src/stores/import-preview-store.ts
import { createStore } from 'zustand/vanilla';
import type { PreviewRow, RawRow, RowId, ValidationContext, ImportEntity, PreviewStatus } from '@/lib/import/types';
import { validateSnapshotRow, type SnapshotResolved } from '@/lib/import/validators/snapshot-validator';
import { validateTransactionRow, type TransactionResolved } from '@/lib/import/validators/transaction-validator';

export interface ParseResultLite {
  headers: string[];
  rows: ReadonlyArray<RawRow>;
  errors: Array<{ line: number; message: string }>;
}

type ResolvedFor<E extends ImportEntity> = E extends 'snapshot' ? SnapshotResolved : TransactionResolved;

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

function selectValidator<E extends ImportEntity>(entity: E) {
  return entity === 'snapshot' ? validateSnapshotRow : validateTransactionRow;
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
