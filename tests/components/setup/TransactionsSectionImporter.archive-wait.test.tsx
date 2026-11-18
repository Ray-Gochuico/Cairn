/**
 * v1.8.0 W4 fix round (PG-4): a statements folder that does not answer holds
 * a saved PDF review for a bounded wait only.
 *
 * Task 5 keeps the review locked (Save, Cancel, the X and Escape) until the
 * importer has archived the PDF. The archive lists and writes the folder with
 * no time limit, so a folder that stopped answering (a dropped network share)
 * kept every exit shut although the rows were saved. Now the review waits at
 * most the importer's archive wait; then the queue moves on and the archive
 * line says the PDF is still being archived, until the archive's own result
 * replaces it. Archives run one at a time, in save order, so two PDFs never
 * pick the same free name in the folder.
 *
 * Two PDFs are queued (a.pdf → ALPHA MART, b.pdf → BRAVO CAFE); a statements
 * folder is set and every archive is held open until the test settles it.
 * The importer is given a 40 ms wait. Clock-free.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  archives: [] as Array<{ filename: string; settle: (warning: string | null) => void }>,
}));

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
    (_folder: string, filename: string) =>
      new Promise<string | null>((resolve) => { h.archives.push({ filename, settle: resolve }); }),
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

const STILL = 'Still archiving the statement PDF. The import itself was saved.';
const FAILED = 'Could not archive the statement PDF: the network share did not answer. The import itself was saved.';
/** A review's async start can outrun RTL's 1 s default under a loaded suite;
 *  this budget stays below vitest's 10 s testTimeout. */
const BUDGET = { timeout: 5000 };
let db: SqliteAdapter;

beforeEach(async () => {
  h.archives.length = 0;
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
    settings: { statementsFolderPath: '/Volumes/NAS/Statements' } as never,
    isLoading: false,
    error: null,
  });
});

afterEach(async () => {
  await db.close();
});

async function queueTwoPdfs() {
  await useCategoriesStore.getState().load();
  const warnings: Array<string | null> = [];
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <TransactionsSectionImporter onArchiveWarning={(w) => warnings.push(w)} archiveWaitMs={40} />
    </MemoryRouter>,
  );
  const a = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
  const b = new File([new Uint8Array([2])], 'b.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [a, b], configurable: true });
  fireEvent.change(input);
  expect(await screen.findByDisplayValue('ALPHA MART', {}, BUDGET)).toBeInTheDocument();
  return { user, warnings };
}

async function stored(): Promise<string[]> {
  await useTransactionsStore.getState().load();
  return useTransactionsStore.getState().transactions.map((t) => t.merchant).sort();
}

describe('PDF review: a folder that does not answer holds it for the wait only (PG-4 fix round)', () => {
  it('after the wait b.pdf opens, live; the line says a.pdf is still being archived until its own result replaces it', async () => {
    const { user, warnings } = await queueTwoPdfs();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.archives).toHaveLength(1));
    expect(await screen.findByDisplayValue('BRAVO CAFE', {}, BUDGET)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(warnings).toEqual([STILL]);
    expect(await stored()).toEqual(['ALPHA MART']);
    await act(async () => { h.archives[0].settle(FAILED); });
    expect(warnings).toEqual([STILL, FAILED]);
    expect(screen.getByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
  });

  it("archives run one at a time: b.pdf's starts only once a.pdf's has settled", async () => {
    const { user, warnings } = await queueTwoPdfs();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.archives).toHaveLength(1));
    expect(await screen.findByDisplayValue('BRAVO CAFE', {}, BUDGET)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // b.pdf's rows are written and its review has let go after the wait,
    // while a.pdf's archive still holds the folder.
    await waitFor(() => expect(screen.queryByDisplayValue('BRAVO CAFE')).toBeNull(), BUDGET);
    expect(await stored()).toEqual(['ALPHA MART', 'BRAVO CAFE']);
    expect(h.archives.map((x) => x.filename)).toEqual(['a.pdf']);
    await act(async () => { h.archives[0].settle(null); });
    await waitFor(() => expect(h.archives.map((x) => x.filename)).toEqual(['a.pdf', 'b.pdf']));
    await act(async () => { h.archives[1].settle(null); });
    expect(warnings).toEqual([STILL, STILL, null, null]);
  });
});
