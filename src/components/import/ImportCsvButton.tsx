import { useRef, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { parseCsv, type ParseResult } from '@/lib/import/parse-csv';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useCategoriesStore } from '@/stores/categories-store';
import {
  buildSnapshotConflictMap,
  buildTransactionDuplicateKeys,
} from '@/lib/import/conflict-detector';
import type { ImportEntity, ValidationContext } from '@/lib/import/types';

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

  const ctx: ValidationContext = useMemo(() => ({
    accounts: accounts.map((a) => ({ id: a.id!, name: a.name })),
    persons: persons.map((p) => ({ id: p.id!, name: p.name })),
    categories: categories.map((c) => ({ id: c.id!, name: c.name })),
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
  }), [accounts, persons, categories, snapshots, transactions, entity]);

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

  return (
    <>
      <Button variant="outline" onClick={() => fileRef.current?.click()}>
        Import CSV
      </Button>
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
          className="mt-2 rounded-md border border-amber-500/30 bg-amber-50/50 p-2 text-xs"
        >
          <div className="font-medium text-amber-900 mb-1">
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
