import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// pdfjs-dist needs DOMMatrix, which jsdom lacks: the extractor is mocked. Each
// queued PDF's first byte names its statement, so the two files parse to
// different rows (a.pdf → ALPHA MART, b.pdf → BRAVO CAFE).
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn(async (bytes: Uint8Array) => [{ str: String(bytes[0]) }]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn((items: Array<{ str: string }>) => ({
    issuer: 'GENERIC',
    transactions:
      items[0]?.str === '1'
        ? [{ date: '2026-03-01', merchantRaw: 'ALPHA MART', merchant: 'ALPHA MART', amount: 12.5 }]
        : [{ date: '2026-03-02', merchantRaw: 'BRAVO CAFE', merchant: 'BRAVO CAFE', amount: 7.25 }],
  })),
}));
// The archive step touches the Tauri fs plugin.
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
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

/**
 * v1.8.0 O2 (CL-O2-3, chip (c)): the importer reused ONE PDF review for every
 * queued PDF, and the review builds its rows once on mount, so the second PDF
 * showed the first PDF's rows under its own name and Save wrote them again.
 * Each queued PDF now mounts its own review (a per-file key).
 */

const ASK = 'Discard unsaved entries?';

let db: SqliteAdapter;

beforeEach(async () => {
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
  useSettingsStore.setState({ settings: null, isLoading: false, error: null });
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

async function stored(): Promise<Array<[string, string | null]>> {
  await useTransactionsStore.getState().load();
  return useTransactionsStore
    .getState()
    .transactions.map((t): [string, string | null] => [t.merchant, t.sourcePdfFilename])
    .sort((x, y) => x[0].localeCompare(y[0]));
}

describe('TransactionsSectionImporter — each queued PDF reviews its own rows (CL-O2-3)', () => {
  it('two queued PDFs: after the first is saved, the second review shows its own rows, and its Save writes them exactly once', async () => {
    const { user } = await queueTwoPdfs();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('ALPHA MART')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review transactions' })).toBeNull());
    expect(await stored()).toEqual([
      ['ALPHA MART', 'a.pdf'],
      ['BRAVO CAFE', 'b.pdf'],
    ]);
  });

  it('a row edited in the first PDF never carries into the second: it starts pristine, and Escape closes it at once', async () => {
    const { user } = await queueTwoPdfs();
    await user.click(screen.getByRole('checkbox', { name: 'Include ALPHA MART' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByDisplayValue('BRAVO CAFE')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review transactions' })).toBeNull());
    expect(await stored()).toEqual([]);
  });
});
