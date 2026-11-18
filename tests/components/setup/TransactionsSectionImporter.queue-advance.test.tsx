/**
 * v1.8.0 W4 (PG-4, task_90fd839b PRIORITY; C041): the importer's queue moves
 * past a file only while that file is the one on screen, for queued PDFs and
 * queued CSVs alike. Both reviews are replaced here by stand-ins that record
 * the callbacks they were given, so a file's own callbacks can be called out
 * of order — the shape the in-flight race had. Clock-free.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type PdfProps = { filename: string; onClose: () => void; onSaved: (n: number, b: Uint8Array) => void | Promise<void> };
type CsvProps = { parsed: { rows: ReadonlyArray<Record<string, string>> }; onOpenChange: (o: boolean) => void; onSaved?: (n: number) => void };
const h = vi.hoisted(() => ({ pdf: [] as PdfProps[], csv: [] as CsvProps[] }));

vi.mock('@/components/dialogs/PdfReviewModal', () => ({
  PdfReviewModal: (p: PdfProps) => {
    h.pdf.push(p);
    return <div data-testid="pdf-review">{p.filename}</div>;
  },
}));
vi.mock('@/components/import/ImportPreviewModal', () => ({
  ImportPreviewModal: (p: CsvProps) => {
    h.csv.push(p);
    return <div data-testid="csv-preview">{p.parsed.rows[0]?.merchant ?? ''}</div>;
  },
}));
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn(async () => []),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn(() => ({ issuer: 'CHASE', transactions: [] })),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useSettingsStore } from '@/stores/settings-store';
import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';

let db: SqliteAdapter;

beforeEach(async () => {
  h.pdf.length = 0;
  h.csv.length = 0;
  db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  setDatabase(db);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
  useSettingsStore.setState({ settings: null, isLoading: false, error: null });
});

afterEach(async () => {
  await db.close();
});

function drop(files: File[]) {
  render(
    <MemoryRouter>
      <TransactionsSectionImporter />
    </MemoryRouter>,
  );
  const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

const pdf = (name: string) => new File([new Uint8Array([1])], name, { type: 'application/pdf' });
const csv = (merchant: string, name: string) =>
  new File([`date,account,amount,merchant\n2026-03-01,Chase Checking,5.00,${merchant}\n`], name, { type: 'text/csv' });

describe('TransactionsSectionImporter: the queue moves past a file only while it is on screen (PG-4, C041)', () => {
  it('a.pdf closed, then its save lands: b.pdf stays on screen', async () => {
    drop([pdf('a.pdf'), pdf('b.pdf')]);
    expect(await screen.findByTestId('pdf-review')).toHaveTextContent('a.pdf');
    const first = h.pdf.at(-1)!;
    act(() => first.onClose());
    expect(screen.getByTestId('pdf-review')).toHaveTextContent('b.pdf');
    await act(async () => { await first.onSaved(1, new Uint8Array([1])); });
    expect(screen.getByTestId('pdf-review')).toHaveTextContent('b.pdf');
  });

  it('a.pdf saved, then a stray close for a.pdf: b.pdf stays on screen', async () => {
    drop([pdf('a.pdf'), pdf('b.pdf')]);
    expect(await screen.findByTestId('pdf-review')).toHaveTextContent('a.pdf');
    const first = h.pdf.at(-1)!;
    await act(async () => { await first.onSaved(1, new Uint8Array([1])); });
    expect(screen.getByTestId('pdf-review')).toHaveTextContent('b.pdf');
    act(() => first.onClose());
    expect(screen.getByTestId('pdf-review')).toHaveTextContent('b.pdf');
  });

  it('one.csv skipped, then its commit lands: two.csv stays on screen', async () => {
    drop([csv('ALPHA', 'one.csv'), csv('BRAVO', 'two.csv')]);
    expect(await screen.findByTestId('csv-preview')).toHaveTextContent('ALPHA');
    const first = h.csv.at(-1)!;
    act(() => first.onOpenChange(false));
    expect(screen.getByTestId('csv-preview')).toHaveTextContent('BRAVO');
    act(() => first.onSaved!(1));
    expect(screen.getByTestId('csv-preview')).toHaveTextContent('BRAVO');
  });
});
