/**
 * v1.8.0 W4 (C040, build-flag ⚑): the PDF review flags as "duplicate" only
 * the rows duplicate detection called copies.
 *
 * filterDuplicates keeps the first of two identical same-day lines on one
 * statement as fresh and calls the second a copy (the phase-4 in-batch rule,
 * pinned by tests/lib/dedup.test.ts). The review then flagged rows by their
 * KEY, so BOTH lines were flagged and unticked, the kept one included, and a
 * default Save dropped both. Rows are now flagged by identity. The in-batch
 * rule itself is unchanged (Ray's C040 question, default "keep today's
 * rule"). Clock-free: literal dates only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { Issuer } from '@/types/enums';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function renderModal(result: ParseResult, existing: Transaction[]) {
  return render(
    <MemoryRouter>
      <PdfReviewModal
        result={result}
        filename="oct.pdf"
        fileBytes={new Uint8Array()}
        existing={existing}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </MemoryRouter>,
  );
}

const tap = { date: '2026-10-03', merchantRaw: 'MTA*NYCT PAYGO NEW YORK NY', merchant: 'MTA', amount: 2.9 };
const other = { date: '2026-10-04', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX', amount: 15.49 };
const savedTap: Transaction = {
  id: 1, householdId: 1, date: '2026-10-03', merchant: 'MTA', merchantRaw: 'MTA*NYCT PAYGO NEW YORK NY',
  amount: 2.9, categoryId: null, sourceAccountId: null, propertyId: null, vehicleId: null,
  personId: null, sourcePdfFilename: 'sep.pdf', reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null,
};
const ticked = (boxes: HTMLElement[]) => boxes.filter((c) => (c as HTMLInputElement).checked).length;

describe('PdfReviewModal flags only the rows duplicate detection called copies (C040)', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0003_add_commission_columns'),
      mig('0005_add_employment_and_bonus_columns'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
      mig('0013_add_category_budget'),
      mig('0051_person_expense_baseline'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });
  afterEach(async () => { await db.close(); });

  it('nothing saved, the same charge twice on one statement: the first stays ticked, only the second is flagged', async () => {
    renderModal({ issuer: Issuer.UNKNOWN, transactions: [tap, { ...tap }, other] }, []);
    await waitFor(() => expect(screen.getByDisplayValue('NETFLIX')).toBeInTheDocument());
    const taps = screen.getAllByRole('checkbox', { name: 'Include MTA' });
    expect(taps).toHaveLength(2);
    expect(ticked(taps)).toBe(1);
    expect(screen.getAllByText('duplicate')).toHaveLength(1);
    expect(screen.getByText('2 of 3 rows will be saved')).toBeInTheDocument();
  });

  it('a re-imported charge that is already saved is still flagged and unticked', async () => {
    renderModal({ issuer: Issuer.UNKNOWN, transactions: [tap] }, [savedTap]);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Include MTA' })).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Include MTA' })).not.toBeChecked();
    expect(screen.getAllByText('duplicate')).toHaveLength(1);
  });

  it("one saved and two on the statement: both flagged, under today's rule (a saved key covers every copy; ⚑ C040)", async () => {
    renderModal({ issuer: Issuer.UNKNOWN, transactions: [tap, { ...tap }] }, [savedTap]);
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Include MTA' })).toHaveLength(2));
    expect(ticked(screen.getAllByRole('checkbox', { name: 'Include MTA' }))).toBe(0);
    expect(screen.getAllByText('duplicate')).toHaveLength(2);
  });
});
