import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
// pdfjs-dist is ~1.2 MB worker + ~200 kB core that the majority of users
// never touch (CSV-only or manual-entry flows skip statement parsing). We
// dynamic-import `@/pdf/extract` inside the user's drop/select handler
// below, which lets Vite emit those bytes as a separate lazy chunk.
import { parseStatement } from '@/pdf/parse-statement';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import { parseCsv, type ParseResult as CsvParseResult } from '@/lib/import/parse-csv';
import { buildTransactionDuplicateKeys } from '@/lib/import/conflict-detector';
import { archiveStatementPdf } from '@/lib/statements-archive';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { ValidationContext } from '@/lib/import/types';
import type { ParseResult as PdfParseResult } from '@/pdf/parse-statement';

type PendingImport =
  | {
      kind: 'pdf';
      filename: string;
      result: PdfParseResult;
      fileBytes: Uint8Array;
    }
  | {
      kind: 'csv';
      filename: string;
      parsed: CsvParseResult;
    };

interface BatchImportError {
  filename: string;
  message: string;
}

interface Props {
  /**
   * Optional callback fired after a successful PDF archive step, with a
   * best-effort warning string (or null on success). Surfaced by the Spending
   * page so the user sees archive failures next to the page header.
   */
  onArchiveWarning?: (warning: string | null) => void;
}

/**
 * Unified PDF + CSV drop zone for transaction imports. Extracted from the
 * Spending page so it can be embedded into the wizard's Section 4
 * Transactions card without duplicating the queue/modal/error logic.
 *
 * Owns:
 *  - The `PendingImport` queue (sequential modals for mixed-batch uploads).
 *  - PDF extraction (via `extractTextItems` + `parseStatement`).
 *  - CSV parsing (via `parseCsv`).
 *  - Per-file parse-error pane.
 *  - The best-effort PDF archive step (folder taken from app settings).
 */
export default function TransactionsSectionImporter({
  onArchiveWarning,
}: Props = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<PendingImport[]>([]);
  const [errors, setErrors] = useState<BatchImportError[]>([]);
  // totalRef tracks the size of the current batch for the optional
  // "File N of M" subtitle on the CSV preview modal. It's a ref (not state)
  // because position is derived from `queue.length` which already triggers
  // re-renders.
  const totalRef = useRef<number>(0);
  const [dragOver, setDragOver] = useState(false);

  const accounts = useAccountsStore((s) => s.accounts);
  const persons = usePersonsStore((s) => s.persons);
  const categories = useCategoriesStore((s) => s.categories);
  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);

  // ValidationContext for the CSV preview modal — mirrors the block on
  // Spending.tsx so the embedded importer routes identically.
  const csvCtx: ValidationContext = useMemo(
    () => ({
      accounts: accounts.map((a) => ({ id: a.id!, name: a.name })),
      persons: persons.map((p) => ({ id: p.id!, name: p.name })),
      categories: categories.map((c) => ({ id: c.id!, name: c.name })),
      existingTransactionKeys: buildTransactionDuplicateKeys(
        transactions
          .filter((t) => t.sourceAccountId != null)
          .map((t) => ({
            accountId: t.sourceAccountId!,
            date: t.date,
            amount: t.amount,
            merchant: t.merchant,
          })),
      ),
    }),
    [accounts, persons, categories, transactions],
  );

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const next: PendingImport[] = [];
    const newErrors: BatchImportError[] = [];

    // Lazy-load the PDF extractor only when this batch actually contains
    // a PDF. The browser doesn't pay the ~1.2 MB pdfjs cost on cold start,
    // and CSV-only batches don't pay it here either.
    const hasPdf = files.some((file) => {
      const lower = file.name.toLowerCase();
      return file.type === 'application/pdf' || lower.endsWith('.pdf');
    });
    const extractTextItems = hasPdf
      ? (await import('@/pdf/extract')).extractTextItems
      : null;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const isPdf =
        file.type === 'application/pdf' || lower.endsWith('.pdf');
      const isCsv = file.type === 'text/csv' || lower.endsWith('.csv');

      try {
        if (isPdf && extractTextItems) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const items = await extractTextItems(bytes);
          const result = parseStatement(items);
          next.push({
            kind: 'pdf',
            filename: file.name,
            result,
            fileBytes: bytes,
          });
        } else if (isCsv) {
          const text = await file.text();
          const parsed = parseCsv(text);
          next.push({ kind: 'csv', filename: file.name, parsed });
        }
        // Unsupported file types: silent skip.
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
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await processFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const lower = f.name.toLowerCase();
      return (
        f.type === 'application/pdf' ||
        lower.endsWith('.pdf') ||
        f.type === 'text/csv' ||
        lower.endsWith('.csv')
      );
    });
    if (files.length > 0) await processFiles(files);
  };

  // Best-effort archive step for PDF imports. Splits the post-save side
  // effects (loadTransactions + archiveStatementPdf) from the queue advance,
  // so the modal's `onSaved` callback can advance the queue separately.
  const archivePdfAfterSave = async (
    filename: string,
    fileBytes: Uint8Array,
  ) => {
    await loadTransactions();
    // Read settings on-demand via getState() — subscribing here would cause
    // the importer to re-render on every Settings write. Defensive load() in
    // case the app's mount load hasn't completed by the time of the very
    // first import.
    let settings = useSettingsStore.getState().settings;
    if (settings === null) {
      await useSettingsStore.getState().load();
      settings = useSettingsStore.getState().settings;
    }
    const folder = settings?.statementsFolderPath ?? null;
    // archiveStatementPdf never throws — a failure returns a warning string.
    if (folder) {
      const warning = await archiveStatementPdf(folder, filename, fileBytes);
      onArchiveWarning?.(warning);
    } else {
      onArchiveWarning?.(null);
    }
  };

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

  const current = queue[0];
  const position =
    current && totalRef.current > 1
      ? { current: totalRef.current - queue.length + 1, total: totalRef.current }
      : undefined;

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-lg p-6 text-center space-y-2 transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/30'
        }`}
      >
        <p className="text-sm text-muted-foreground">
          Drop PDFs or CSVs here, or click to browse
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.csv,text/csv"
          multiple
          className="hidden"
          onChange={handleFileInput}
          aria-label="Transactions PDF or CSV"
        />
      </div>

      {errors.length > 0 && (
        <div
          role="alert"
          data-testid="batch-import-errors"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"
        >
          <div className="font-medium text-warning-foreground mb-1">
            Couldn&apos;t import {errors.length}{' '}
            {errors.length === 1 ? 'file' : 'files'}:
          </div>
          <ul className="space-y-0.5 text-xs">
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

      {current?.kind === 'pdf' && (
        <PdfReviewModal
          result={current.result}
          filename={current.filename}
          fileBytes={current.fileBytes}
          existing={transactions}
          onClose={advance}
          onSaved={async (_insertedCount, fileBytes) => {
            await archivePdfAfterSave(current.filename, fileBytes);
            advance();
          }}
        />
      )}
      {current?.kind === 'csv' && (
        <ImportPreviewModal
          entity="transaction"
          parsed={current.parsed}
          ctx={csvCtx}
          open={true}
          onOpenChange={(o) => {
            // Wave-9 S80 (mirrors ImportCsvButton's M4 fix): closing skips
            // just the CURRENT file; "Cancel all" is the explicit batch drop.
            if (!o) advance();
          }}
          queuePosition={position}
          queueLength={queue.length}
          onCancelAll={dropAll}
          onSaved={() => advance()}
        />
      )}
    </div>
  );
}
