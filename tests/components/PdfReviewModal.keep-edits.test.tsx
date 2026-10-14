import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { getDatabase, setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { Issuer, PropertyType } from '@/types/enums';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import type { ParseResult } from '@/pdf/parse-statement';

/**
 * v1.8.0 O2 (CR-O-3): the PDF review is reachable from the worded Import
 * gate (ImportGateStep → TransactionsSectionImporter) and form-view
 * Section 4; closing it skips the PDF (TransactionsSectionImporter.tsx:303).
 * Its backdrop click was already blocked (PdfReviewModal.tsx:252-253), but
 * Escape skipped the PDF with every row edit in it. Once a row is edited,
 * Escape now asks first.
 */

const ASK = 'Discard unsaved entries?';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const result: ParseResult = {
  issuer: Issuer.GENERIC,
  transactions: [
    { date: '2026-03-05', merchantRaw: 'WHOLE FOODS MARKET', merchant: 'WHOLE FOODS MARKET', amount: 54.23 },
    { date: '2026-03-06', merchantRaw: 'VENMO PAYMENT', merchant: 'VENMO', amount: 100 },
  ],
};

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

afterEach(async () => {
  await db.close();
});

async function renderModal() {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <PdfReviewModal
        result={result}
        filename="statement.pdf"
        fileBytes={new Uint8Array()}
        existing={[]}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    </MemoryRouter>,
  );
  await screen.findByDisplayValue('VENMO');
  return { onClose, user };
}

describe('PdfReviewModal — keeps row edits (CR-O-3)', () => {
  it('Escape on an unedited review closes it at once, as before', async () => {
    const { onClose, user } = await renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it('after "Exclude (transfer)" (a button, no field event), Escape asks; Stay keeps the row; Discard entries closes', async () => {
    const { onClose, user } = await renderModal();
    await user.click(screen.getByRole('button', { name: 'Exclude transfer for VENMO' }));
    const category = screen.getByRole('combobox', { name: 'Category for VENMO' }) as HTMLSelectElement;
    const transfer = category.value;
    expect(category.selectedOptions[0].textContent).toBe('Transfer');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox', { name: 'Category for VENMO' }) as HTMLSelectElement).value).toBe(transfer);
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Discard entries' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a row edited in a field (the Include checkbox): Escape asks first', async () => {
    const { onClose, user } = await renderModal();
    const include = screen.getByRole('checkbox', { name: 'Include VENMO' });
    await user.click(include);
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a pointer-down on the overlay still never closes it', async () => {
    const { onClose, user } = await renderModal();
    await user.click(screen.getByRole('button', { name: 'Exclude transfer for VENMO' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    fireEvent.pointerDown(document.querySelector('[data-state="open"].fixed.inset-0')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Review transactions' })).toBeInTheDocument();
  });

  it('Cancel stays an immediate, explicit close', async () => {
    const { onClose, user } = await renderModal();
    await user.click(screen.getByRole('button', { name: 'Exclude transfer for VENMO' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });
});

describe('PdfReviewModal — a category change keeps a pick that still fits (O1 chip (d), CR-O-2)', () => {
  async function seedTwoOfEach() {
    const props = new PropertiesRepo(getDatabase());
    for (const name of ['Main House', 'Lake Cabin']) {
      await props.create({
        householdId: 1, ownerPersonId: null, name, type: PropertyType.PRIMARY_RESIDENCE, address: null,
        purchaseDate: null, purchasePrice: null, currentEstimatedValue: null, linkedLoanId: null, excludedFromNetWorth: false,
      });
    }
    const cars = new VehiclesRepo(getDatabase());
    for (const name of ['Daily', 'Weekend']) {
      await cars.create({
        householdId: 1, ownerPersonId: null, name, year: null, make: null, model: null,
        purchaseDate: null, purchasePrice: null, currentEstimatedValue: null, linkedLoanId: null, excludedFromNetWorth: false,
      });
    }
  }
  const option = (select: HTMLElement, text: string) =>
    within(select).getByRole('option', { name: text }) as HTMLOptionElement;

  it('two properties: a picked property stays through a change to another Home category, and clears on a change of family', async () => {
    await seedTwoOfEach();
    const { user } = await renderModal();
    const category = screen.getByRole('combobox', { name: 'Category for WHOLE FOODS MARKET' });
    await user.selectOptions(category, option(category, 'Mortgage Interest'));
    const property = screen.getByRole('combobox', { name: 'Property for WHOLE FOODS MARKET' }) as HTMLSelectElement;
    expect(property.value).toBe('');
    await user.selectOptions(property, option(property, 'Lake Cabin'));
    await user.selectOptions(category, option(category, 'Utilities'));
    expect((screen.getByRole('combobox', { name: 'Property for WHOLE FOODS MARKET' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Lake Cabin');
    await user.selectOptions(category, option(category, 'Gas/Fuel'));
    expect(screen.queryByRole('combobox', { name: 'Property for WHOLE FOODS MARKET' })).toBeNull();
    await user.selectOptions(category, option(category, 'Utilities'));
    expect((screen.getByRole('combobox', { name: 'Property for WHOLE FOODS MARKET' }) as HTMLSelectElement).value).toBe('');
  });

  it('two vehicles: a picked vehicle stays through a change to another Vehicles category, and clears on a change of family', async () => {
    await seedTwoOfEach();
    const { user } = await renderModal();
    const category = screen.getByRole('combobox', { name: 'Category for WHOLE FOODS MARKET' });
    await user.selectOptions(category, option(category, 'Gas/Fuel'));
    const vehicle = screen.getByRole('combobox', { name: 'Vehicle for WHOLE FOODS MARKET' });
    await user.selectOptions(vehicle, option(vehicle, 'Weekend'));
    await user.selectOptions(category, option(category, 'Auto Insurance'));
    expect((screen.getByRole('combobox', { name: 'Vehicle for WHOLE FOODS MARKET' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Weekend');
    await user.selectOptions(category, option(category, 'Utilities'));
    expect(screen.queryByRole('combobox', { name: 'Vehicle for WHOLE FOODS MARKET' })).toBeNull();
    await user.selectOptions(category, option(category, 'Gas/Fuel'));
    expect((screen.getByRole('combobox', { name: 'Vehicle for WHOLE FOODS MARKET' }) as HTMLSelectElement).value).toBe('');
  });
});
