/**
 * v1.8.0 W4 (C009, MAJOR): the statements archive receives the whole PDF.
 *
 * The REAL TransactionsSectionImporter, the REAL src/pdf/extract.ts, the REAL
 * PdfReviewModal Save and the REAL archiveStatementPdf, with only the outer
 * boundaries stubbed:
 *  - 'pdfjs-dist': getDocument({ data }) does to `data` what pdfjs-dist
 *    5.7.284 does (tests/pdf/extract.bytes.test.ts shows it on the real
 *    build): it posts it to the worker with [data.buffer] in the transfer
 *    list, which detaches the array it was handed. It then resolves a
 *    one-page document with no text.
 *  - the worker's ?url import (a Vite asset path);
 *  - parse-statement (one row, so the review has something to save);
 *  - @tauri-apps/plugin-fs and the path API (what writeFile is asked to write).
 * Clock-free.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handedToPdfjs: [] as Uint8Array[],
  writes: [] as Array<{ path: string; len: number }>,
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: ({ data }: { data: Uint8Array }) => {
    h.handedToPdfjs.push(data);
    structuredClone({ data }, { transfer: [data.buffer as ArrayBuffer] });
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ height: 792 }),
          getTextContent: async () => ({ items: [] }),
          cleanup: () => {},
        }),
        destroy: async () => {},
      }),
    };
  },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.min.mjs' }));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn(() => ({
    issuer: 'CHASE',
    transactions: [
      { date: '2026-03-01', merchantRaw: 'ALPHA MART', merchant: 'ALPHA MART', amount: 12.5 },
    ],
  })),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => true),
  readDir: vi.fn(async () => []),
  writeFile: vi.fn(async (path: string, data: Uint8Array) => {
    h.writes.push({ path, len: data.byteLength });
  }),
}));
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (a: string, b: string) => `${a}/${b}`),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';

let db: SqliteAdapter;
/** The review's async start (the extract module's dynamic import, the parse,
 *  five store loads on a migrated database) can outrun RTL's 1 s default
 *  under a loaded suite; this budget stays below vitest's 10 s testTimeout. */
const REVIEW_OPENS = { timeout: 5000 };

beforeEach(async () => {
  h.handedToPdfjs.length = 0;
  h.writes.length = 0;
  db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  setDatabase(db);
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
  useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSettingsStore.setState({
    settings: { statementsFolderPath: '/Users/x/Statements' } as never,
    isLoading: false,
    error: null,
  });
});

afterEach(async () => {
  await db.close();
});

describe('TransactionsSectionImporter archives the whole statement PDF (C009)', () => {
  it('a saved PDF review writes every byte of the file to the archive folder, with no warning', async () => {
    await useCategoriesStore.getState().load();
    const warnings: Array<string | null> = [];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TransactionsSectionImporter onArchiveWarning={(w) => warnings.push(w)} />
      </MemoryRouter>,
    );
    const payload = new Uint8Array(600);
    payload.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
    const pdf = new File([payload], 'chase-mar.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByDisplayValue('ALPHA MART', {}, REVIEW_OPENS)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(warnings).toEqual([null]));

    // pdf.js was handed the statement, and the copy it was handed is gone ...
    expect(h.handedToPdfjs).toHaveLength(1);
    expect(h.handedToPdfjs[0].byteLength).toBe(0);
    // ... while the archive got all 600 bytes.
    expect(h.writes).toEqual([{ path: '/Users/x/Statements/chase-mar.pdf', len: 600 }]);
    const stored = await db.select<{ merchant: string }>('SELECT merchant FROM transactions');
    expect(stored.map((r) => r.merchant)).toEqual(['ALPHA MART']);
  });
});
