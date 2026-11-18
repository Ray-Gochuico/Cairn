/**
 * v1.8.0 W4 (G2-10, build-flag ⚑): the PDF review names the bank in words,
 * and shows the charges and credits totals of the rows to be saved beside the
 * row count, so each statement can be checked against its printed totals.
 * Synthetic rows (a later PDF-parser lane's fixes re-pin nothing here).
 * Clock-free: literal dates only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function mount(result: ParseResult, filename = 'eStmt_2026-10-31.pdf', existing: Transaction[] = []) {
  return render(
    <MemoryRouter>
      <PdfReviewModal result={result} filename={filename} fileBytes={new Uint8Array()}
        existing={existing} onClose={vi.fn()} onSaved={vi.fn()} />
    </MemoryRouter>,
  );
}

// The three-row Bank of America result of the G2 review's probe.
const boa: ParseResult = {
  issuer: Issuer.BOA,
  transactions: [
    { date: '2026-10-01', merchantRaw: 'ACME CORP DES:PAYROLL', merchant: 'ACME CORP DES:PAYROLL', amount: 3000 },
    { date: '2026-10-05', merchantRaw: 'CHECKCARD 1004 SAFEWAY #1234', merchant: 'CHECKCARD 1004 SAFEWAY #1234', amount: -45 },
    { date: '2026-10-09', merchantRaw: 'PGANDE DES:WEB ONLINE', merchant: 'PGANDE DES:WEB ONLINE', amount: -180 },
  ],
};

describe('PdfReviewModal: the bank and the totals (G2-10)', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'), mig('0003_add_commission_columns'), mig('0005_add_employment_and_bonus_columns'),
      mig('0008_add_transaction_property_links'), mig('0012_add_transaction_person'), mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'), mig('0013_add_category_budget'), mig('0051_person_expense_baseline'),
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

  describe('the bank, in words', () => {
    it('the description names the bank, not its code', () => {
      mount(boa);
      const description = screen.getByText(/eStmt_2026-10-31\.pdf/);
      expect(description).toHaveTextContent('Bank of America · eStmt_2026-10-31.pdf');
    });

    it('a statement Cairn could not place reads "Bank not recognized"', () => {
      mount({ issuer: Issuer.UNKNOWN, transactions: [] }, 'scan.pdf');
      expect(screen.getByText(/scan\.pdf/)).toHaveTextContent('Bank not recognized · scan.pdf');
    });
  });
  describe('the totals of the rows to be saved', () => {
    /** The footer line: the totals, then the row count (its own element). */
    const footerLine = (n: number, m: number) =>
      screen.getByText(`${n} of ${m} rows will be saved`).parentElement!.textContent;

    it('shows the charges and credits beside the row count', async () => {
      mount(boa);
      await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Include/ })).toHaveLength(3));
      expect(footerLine(3, 3)).toBe('Charges $3,000.00 · Credits $225.00 · 3 of 3 rows will be saved');
    });

    it('an unticked row leaves both totals', async () => {
      const user = userEvent.setup();
      mount(boa);
      await user.click(await screen.findByRole('checkbox', { name: 'Include ACME CORP DES:PAYROLL' }));
      expect(footerLine(2, 3)).toBe('Charges $0.00 · Credits $225.00 · 2 of 3 rows will be saved');
      await user.click(screen.getByRole('checkbox', { name: 'Include PGANDE DES:WEB ONLINE' }));
      expect(footerLine(1, 3)).toBe('Charges $0.00 · Credits $45.00 · 1 of 3 rows will be saved');
    });

    it('a duplicate, unticked by default, is left out', async () => {
      const savedSafeway: Transaction = {
        id: 1, householdId: 1, date: '2026-10-05', merchant: 'CHECKCARD 1004 SAFEWAY #1234',
        merchantRaw: 'CHECKCARD 1004 SAFEWAY #1234', amount: -45, categoryId: null, sourceAccountId: null,
        propertyId: null, vehicleId: null, personId: null, sourcePdfFilename: 'eStmt_2026-10-31.pdf',
        reimbursable: false, reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
      };
      mount(boa, 'eStmt_2026-10-31.pdf', [savedSafeway]);
      await waitFor(() => expect(screen.getAllByText('duplicate')).toHaveLength(1));
      expect(footerLine(2, 3)).toBe('Charges $3,000.00 · Credits $180.00 · 2 of 3 rows will be saved');
    });

    it('an edited amount is counted as edited', async () => {
      mount(boa);
      const amount = await screen.findByRole('spinbutton', { name: 'Amount for CHECKCARD 1004 SAFEWAY #1234' });
      fireEvent.change(amount, { target: { value: '-50.25' } });
      expect(footerLine(3, 3)).toBe('Charges $3,000.00 · Credits $230.25 · 3 of 3 rows will be saved');
    });

    it('cents are kept, not rounded to dollars, and add up exactly', async () => {
      mount({
        issuer: Issuer.CHASE,
        transactions: [
          { date: '2026-10-02', merchantRaw: 'COFFEE ONE', merchant: 'COFFEE ONE', amount: 0.1 },
          { date: '2026-10-03', merchantRaw: 'COFFEE TWO', merchant: 'COFFEE TWO', amount: 0.2 },
          { date: '2026-10-04', merchantRaw: 'BOOKS', merchant: 'BOOKS', amount: 12.34 },
          { date: '2026-10-05', merchantRaw: 'REFUND', merchant: 'REFUND', amount: -45.5 },
        ],
      });
      await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Include/ })).toHaveLength(4));
      expect(footerLine(4, 4)).toBe('Charges $12.64 · Credits $45.50 · 4 of 4 rows will be saved');
    });

    it('with no rows, only the row count shows', () => {
      mount({ issuer: Issuer.CHASE, transactions: [] });
      expect(screen.getByText('0 of 0 rows will be saved')).toBeInTheDocument();
      expect(screen.queryByText(/Charges/)).toBeNull();
    });
  });
});
