/**
 * v1.8.0 W4 (G2-10, build-flag ⚑): the PDF review names the bank in words,
 * and shows the charges and credits totals of the rows to be saved beside the
 * row count, so each statement can be checked against its printed totals.
 * Synthetic rows (a later PDF-parser lane's fixes re-pin nothing here).
 * Clock-free: literal dates only.
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
});
