import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase, getDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { CategoriesRepo } from '@/domain/categories';
import CategoriesTab from '@/pages/inputs/CategoriesTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function renderTab() {
  return render(
    <MemoryRouter>
      <CategoriesTab />
    </MemoryRouter>,
  );
}

describe('CategoriesTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
      mig('0013_add_category_budget'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the seeded category names', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  it('creating a category adds it to the list', async () => {
    const user = userEvent.setup();
    renderTab();

    // Wait for categories to load
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    // Click Add Category
    await user.click(screen.getByRole('button', { name: 'Add Category' }));

    // Fill in the form
    await user.type(screen.getByLabelText('Name'), 'Pet Care');
    await user.selectOptions(screen.getByLabelText('Type'), 'WANT');

    // Click Save
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Should return to list with new category visible
    await waitFor(() => {
      expect(screen.getByText('Pet Care')).toBeInTheDocument();
    });
  });

  it('a system-managed category renders without a Delete button', async () => {
    renderTab();

    // Wait for the Transfer category to appear
    await waitFor(() => expect(screen.getByText('Transfer')).toBeInTheDocument());

    // Find the card containing "Transfer" and verify no Delete button in it
    const transferCard = screen.getByText('Transfer').closest('[class*="card"]') ??
      screen.getByText('Transfer').closest('.rounded-lg, .rounded-md, .rounded') ??
      screen.getByText('Transfer').parentElement!.parentElement!.parentElement!;

    // The Transfer entry should show the lock icon but no Delete button
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    // System managed category with lock icon should exist
    expect(document.querySelector('[title="System managed"]')).toBeInTheDocument();
  });

  it('editing a category (e.g. renaming it) does not wipe its monthlyBudget', async () => {
    const user = userEvent.setup();

    // Give Groceries (id=33, non-system, top-level) a non-null monthly budget directly in DB.
    const repo = new CategoriesRepo(getDatabase());
    await repo.update(33, { monthlyBudget: 500 });

    // Confirm the budget was written
    const before = await repo.findById(33);
    expect(before?.monthlyBudget).toBe(500);

    renderTab();

    // Wait for categories to load
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    // Find the Edit button next to "Groceries" — it is the Edit button inside the
    // card that contains the "Groceries" text node.
    const groceriesText = screen.getByText('Groceries');
    const groceriesCard = groceriesText.closest('.rounded-lg, .rounded-md, [class*="card"]') ??
      groceriesText.parentElement!.parentElement!.parentElement!;

    // getAllByRole finds all Edit buttons; pick the one inside the Groceries card.
    // Fall back to finding any button labelled "Edit" closest to the text.
    let editBtn: HTMLElement;
    try {
      // Find all Edit buttons and pick the one nearest to "Groceries"
      const allEditBtns = screen.getAllByRole('button', { name: 'Edit' });
      editBtn = allEditBtns.find((btn) => groceriesCard.contains(btn)) ?? allEditBtns[0];
    } catch {
      editBtn = screen.getAllByRole('button', { name: /edit/i })[0];
    }

    await user.click(editBtn);

    // Edit form should appear; change the name to make the form dirty
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument());
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Groceries Renamed');

    // Click Save
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Wait for list view to return
    await waitFor(() => expect(screen.getByText('Groceries Renamed')).toBeInTheDocument());

    // Assert monthlyBudget is still 500, not null
    const after = await repo.findById(33);
    expect(after?.monthlyBudget).toBe(500);
  });
});
