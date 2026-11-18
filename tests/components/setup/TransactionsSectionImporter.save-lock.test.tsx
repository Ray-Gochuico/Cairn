/**
 * v1.8.0 W4 (PG-4, task_90fd839b PRIORITY; C041): a PDF review stays locked
 * from Save until the importer has finished with that PDF.
 *
 * The review called the importer's onSaved without waiting for it, so Save,
 * Cancel and the X came back while the importer was still archiving the PDF:
 * a second Save wrote every row again, and a Cancel or the X advanced the
 * queue past the NEXT PDF, which then vanished unreviewed when the archive
 * step finished and advanced it again. The X and Escape were live even while
 * the rows were being written.
 *
 * Two PDFs are queued (a.pdf → ALPHA MART, b.pdf → BRAVO CAFE); a statements
 * folder is set, so the archive step runs and is held open. Clock-free.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ archives: [] as Array<() => void> }));

vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn(async (bytes: Uint8Array) => [{ str: String(bytes[0]) }]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn((items: Array<{ str: string }>) => ({
    issuer: 'CHASE',
    transactions:
      items[0]?.str === '1'
        ? [{ date: '2026-03-01', merchantRaw: 'ALPHA MART', merchant: 'ALPHA MART', amount: 12.5 }]
        : [{ date: '2026-03-02', merchantRaw: 'BRAVO CAFE', merchant: 'BRAVO CAFE', amount: 7.25 }],
  })),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn(
    () => new Promise<string | null>((resolve) => { h.archives.push(() => resolve(null)); }),
  ),
  resolveArchivePath: vi.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const ASK = 'Discard unsaved entries?';
const ORIGINAL_CREATE_MANY = useTransactionsStore.getState().createMany;
let db: SqliteAdapter;

beforeEach(async () => {
  h.archives.length = 0;
  db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  setDatabase(db);
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
  useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, createMany: ORIGINAL_CREATE_MANY });
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

async function queueTwoPdfs() {
  await useCategoriesStore.getState().load();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <TransactionsSectionImporter />
    </MemoryRouter>,
  );
  const a = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
  const b = new File([new Uint8Array([2])], 'b.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [a, b], configurable: true });
  fireEvent.change(input);
  expect(await screen.findByDisplayValue('ALPHA MART')).toBeInTheDocument();
  return { user };
}

/** Holds the batch write until the returned release() is called. */
function holdCreateMany(): { release: () => void; started: () => boolean } {
  let release: (() => void) | null = null;
  useTransactionsStore.setState({
    createMany: async (rows) => {
      await new Promise<void>((r) => { release = r; });
      return ORIGINAL_CREATE_MANY(rows);
    },
  });
  return { release: () => release!(), started: () => release !== null };
}

async function stored(): Promise<string[]> {
  await useTransactionsStore.getState().load();
  return useTransactionsStore.getState().transactions.map((t) => t.merchant).sort();
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

describe('PDF review: locked from Save until the importer is done with the PDF (PG-4, C041)', () => {
  it('the X while the rows are being written does nothing; then b.pdf opens and stays open', async () => {
    const { user } = await queueTwoPdfs();
    const write = holdCreateMany();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(write.started()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByDisplayValue('ALPHA MART')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('BRAVO CAFE')).toBeNull();
    await act(async () => { write.release(); });
    await waitFor(() => expect(h.archives).toHaveLength(1));
    await act(async () => { h.archives[0](); });
    expect(await screen.findByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    await settle();
    expect(screen.getByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    expect(await stored()).toEqual(['ALPHA MART']);
  });

  it('Save and Cancel stay disabled until the archive step finishes; then b.pdf opens, live, and stays open', async () => {
    const { user } = await queueTwoPdfs();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.archives).toHaveLength(1));
    // a.pdf's rows are written and its archive is still running.
    expect(screen.getByDisplayValue('ALPHA MART')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { h.archives[0](); });
    expect(await screen.findByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await settle();
    expect(screen.getByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
  });

  it('a second Save during the archive step cannot write a.pdf again', async () => {
    const { user } = await queueTwoPdfs();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.archives).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /^Sav/ }));
    await settle();
    h.archives.forEach((r) => r());
    await settle();
    expect(h.archives).toHaveLength(1);
    expect(await stored()).toEqual(['ALPHA MART']);
  });

  it('Escape while the rows are being written, after a row edit, asks nothing and closes nothing', async () => {
    const { user } = await queueTwoPdfs();
    const merchant = screen.getByRole('textbox', { name: 'Merchant name for row 1' });
    await user.clear(merchant);
    await user.type(merchant, 'ALPHA MARKET');
    const write = holdCreateMany();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(write.started()).toBe(true));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByDisplayValue('ALPHA MARKET')).toBeInTheDocument();
    await act(async () => { write.release(); });
    await waitFor(() => expect(h.archives).toHaveLength(1));
    await act(async () => { h.archives[0](); });
    expect(await screen.findByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    expect(await stored()).toEqual(['ALPHA MARKET']);
  });
});
