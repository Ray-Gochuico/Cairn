import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// pdfjs-dist uses DOMMatrix which is not available in jsdom; the Spending page
// pulls it in transitively via TransactionsSectionImporter. Mirror the mocks
// from Spending.test.tsx so the page imports cleanly.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({ issuer: 'GENERIC', transactions: [] }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

// Capture every BarChartCard render's props so we can assert Spending wires the
// month-key x-axis to formatMonth (humanized 'Jun 2026', never raw '2026-06').
const chartProps: Array<{ title: string; xTickFormatter?: (v: unknown) => string }> = [];
vi.mock('@/components/charts/BarChartCard', () => ({
  default: (props: { title: string; xTickFormatter?: (v: unknown) => string }) => {
    chartProps.push({ title: props.title, xTickFormatter: props.xTickFormatter });
    return <div data-testid={`barchart-${props.title}`} />;
  },
}));

import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import Spending from '@/pages/Spending';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const realTransactionsLoad = useTransactionsStore.getState().load;

describe('Spending — Monthly-by-category x-axis date humanization (Wave-11 T4 miss)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    chartProps.length = 0;
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0003_add_commission_columns'),
      mig('0005_add_employment_and_bonus_columns'),
      mig('0007_add_account_margin'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
      mig('0013_add_category_budget'),
      mig('0014_add_app_settings'),
      mig('0015_add_accent_colors'),
      mig('0024_cash_apy'),
      mig('0036_add_rent_lease_tracking'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: realTransactionsLoad });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useHousingPaymentsStore.setState({ housingPayments: [], isLoading: false, error: null });
    useVehicleLeasesStore.setState({ vehicleLeases: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('passes an x-axis tick formatter that humanizes YYYY-MM month keys', async () => {
    await useCategoriesStore.getState().load();
    const base: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-06-05', merchant: 'AMAZON', merchantRaw: 'AMAZON',
      amount: 42, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    await useTransactionsStore.getState().createMany([
      { ...base, date: '2026-06-05' },
      { ...base, date: '2026-07-05' },
    ]);

    render(
      <MemoryRouter>
        <Spending />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(chartProps.some((c) => c.title === 'Monthly Spending by Category')).toBe(true);
    });
    const monthly = chartProps.find((c) => c.title === 'Monthly Spending by Category');
    expect(monthly?.xTickFormatter).toBeTypeOf('function');
    // Humanized 'Jun 2026', never the raw ISO month key.
    expect(monthly!.xTickFormatter!('2026-06')).toBe('Jun 2026');
    expect(monthly!.xTickFormatter!('2026-06')).not.toBe('2026-06');
  });
});
