import { useState, useRef, useEffect, useCallback } from 'react';
import { extractTextItems } from '@/pdf/extract';
import { parseStatement } from '@/pdf/parse-statement';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import type { ParseResult } from '@/pdf/parse-statement';

interface PendingImport {
  result: ParseResult;
  filename: string;
}

export default function Spending() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<PendingImport[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);

  useEffect(() => {
    loadTransactions();
    loadCategories();
  }, [loadTransactions, loadCategories]);

  const processFiles = useCallback(async (files: File[]) => {
    setImportError(null);
    const results: PendingImport[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const items = await extractTextItems(bytes);
        const result = parseStatement(items);
        results.push({ result, filename: file.name });
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      }
    }
    if (results.length > 0) {
      setQueue((prev) => [...prev, ...results]);
    }
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
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf',
    );
    if (files.length > 0) await processFiles(files);
  };

  const handleModalClose = () => {
    setQueue((prev) => prev.slice(1));
  };

  const handleModalSaved = (insertedCount: number) => {
    // Reload transactions so the list reflects the new rows
    loadTransactions();
    setQueue((prev) => prev.slice(1));
    // eslint-disable-next-line no-console
    console.info('[spending] imported', insertedCount, 'transactions');
  };

  const current = queue[0];

  // Build category lookup for display
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Spending</h1>

      {/* Import area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center space-y-3 transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
      >
        <p className="text-sm text-muted-foreground">
          Import a credit card statement PDF to track spending.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Import statement
        </button>
        <p className="text-xs text-muted-foreground">or drag and drop a PDF here</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={handleFileInput}
          aria-label="Statement PDF"
        />
      </div>

      {importError && (
        <p className="text-sm text-destructive" role="alert">
          {importError}
        </p>
      )}

      {/* Transactions list */}
      <div className="space-y-2">
        <h2 className="text-lg font-medium">Transactions</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transactions yet. Import a statement to get started.
          </p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Merchant</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...transactions]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 pr-4">{t.date}</td>
                    <td className="py-2 pr-4">{t.merchant}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {t.categoryId != null
                        ? (categoryById.get(t.categoryId)?.name ?? '—')
                        : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {t.amount < 0 ? (
                        <span className="text-green-600">
                          {t.amount.toFixed(2)}
                        </span>
                      ) : (
                        <span>{t.amount.toFixed(2)}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Review modal — shows for the first item in the queue */}
      {current && (
        <PdfReviewModal
          result={current.result}
          filename={current.filename}
          existing={transactions}
          onClose={handleModalClose}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  );
}
