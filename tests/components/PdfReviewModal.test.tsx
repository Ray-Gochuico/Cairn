import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Issuer } from '@/types/enums';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function makeResult(transactions: ParseResult['transactions']): ParseResult {
  return { issuer: Issuer.GENERIC, transactions };
}

function renderModal(
  result: ParseResult,
  existing: Transaction[],
  onClose = vi.fn(),
  onSaved = vi.fn(),
) {
  return render(
    <MemoryRouter>
      <PdfReviewModal
        result={result}
        filename="test.pdf"
        existing={existing}
        onClose={onClose}
        onSaved={onSaved}
      />
    </MemoryRouter>,
  );
}

describe('PdfReviewModal', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('(a) renders one row per parsed transaction', async () => {
    const result = makeResult([
      { date: '2026-03-05', merchantRaw: 'WHOLE FOODS MARKET', merchant: 'WHOLE FOODS MARKET', amount: 54.23 },
      { date: '2026-03-06', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX', amount: 15.49 },
    ]);
    renderModal(result, []);

    // Should render the dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Should eventually render both merchant names
    await waitFor(() => {
      expect(screen.getByDisplayValue('WHOLE FOODS MARKET')).toBeInTheDocument();
      expect(screen.getByDisplayValue('NETFLIX')).toBeInTheDocument();
    });
  });

  it('(b) a row whose dedup key matches an existing transaction renders unchecked with duplicate badge', async () => {
    const txn: ParseResult['transactions'][0] = {
      date: '2026-03-05', merchantRaw: 'AMAZON.COM', merchant: 'AMAZON', amount: 54.23,
    };
    const result = makeResult([txn]);
    const existing: Transaction[] = [{
      id: 1, householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: null, sourceAccountId: null, propertyId: null, vehicleId: null,
      sourcePdfFilename: null, reimbursable: false, reimbursedAt: null, reimbursedAmount: null,
      isRecurring: false, notes: null,
    }];

    renderModal(result, existing);

    await waitFor(() => {
      expect(screen.getByDisplayValue('AMAZON')).toBeInTheDocument();
    });

    // The include checkbox should be unchecked
    const checkbox = screen.getByRole('checkbox', { name: /include amazon/i });
    expect(checkbox).not.toBeChecked();

    // The duplicate badge should be visible
    expect(screen.getByText('duplicate')).toBeInTheDocument();
  });

  it('(c) clicking Save calls onSaved with count of checked rows and rows land in transactions', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    const result = makeResult([
      { date: '2026-03-05', merchantRaw: 'STARBUCKS #123', merchant: 'STARBUCKS', amount: 7.50 },
      { date: '2026-03-06', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX', amount: 15.49 },
    ]);
    renderModal(result, [], vi.fn(), onSaved);

    // Wait for rows to appear
    await waitFor(() => {
      expect(screen.getByDisplayValue('STARBUCKS')).toBeInTheDocument();
    });

    // Both rows should be checked by default (no duplicates)
    const checkboxes = screen.getAllByRole('checkbox', { name: /include/i });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    // Uncheck second row
    await user.click(checkboxes[1]);
    expect(checkboxes[1]).not.toBeChecked();

    // Save
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // onSaved should be called with 1 (only first row was included)
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(1);
    });

    // The transaction should be in the DB
    const { transactions } = useTransactionsStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].merchant).toBe('STARBUCKS');
  });
});
