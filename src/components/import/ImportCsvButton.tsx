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

export function ImportCsvButton({ entity }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [open, setOpen] = useState(false);

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
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setParsed(parseCsv(text));
    setOpen(true);
    e.target.value = '';
  }

  return (
    <>
      <Button variant="outline" onClick={() => fileRef.current?.click()}>
        Import CSV
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        data-testid="import-csv-file-input"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      {parsed && (
        <ImportPreviewModal
          entity={entity}
          parsed={parsed}
          ctx={ctx}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
