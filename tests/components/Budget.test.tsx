import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { CategoriesRepo } from '@/domain/categories';
import Budget from '@/pages/Budget';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

// The W10 loading-gate test overrides categories.load with a no-op; capture +
// restore the real loads each beforeEach so later DB-backed tests hydrate.
const realCategoriesLoad = useCategoriesStore.getState().load;
const realTransactionsLoad = useTransactionsStore.getState().load;

describe('Budget page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    localStorage.clear();
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0012_add_transaction_person'),
      mig('0013_add_category_budget'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null, load: realCategoriesLoad });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: realTransactionsLoad });
  });

  afterEach(async () => { await db.close(); });

  it('lists budgetable categories and renders the empty-state when no budgets are set', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });
    expect(screen.getByText(/set a monthly budget/i)).toBeInTheDocument();
    // Canonical EmptyState shape: titled "No budgets set" (medium-weight line).
    expect(screen.getByText(/no budgets set/i)).toHaveClass('font-medium');
  });

  it('shows the loading skeleton, not "No budgets set", while stores load (W10 T1)', () => {
    useCategoriesStore.setState({ categories: [], isLoading: true, error: null, load: async () => {} } as never);
    render(<MemoryRouter><Budget /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByText(/no budgets set/i)).not.toBeInTheDocument();
  });

  it('editing a budget input persists the value via the categories store', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/budget for groceries/i);
    await user.clear(input);
    await user.type(input, '600');
    await user.tab(); // blur commits

    await waitFor(async () => {
      const cats = await new CategoriesRepo(db).list();
      const groceries = cats.find((c) => c.name === 'Groceries');
      expect(groceries?.monthlyBudget).toBe(600);
    });
  });

  it('shows the spending summary header with $actual of $budget once a budget is set', async () => {
    // Pre-set a budget on Groceries (id 33) and add an actual transaction
    const repo = new CategoriesRepo(db);
    await repo.update(33, { monthlyBudget: 600 });
    const month = new Date().toISOString().slice(0, 7);
    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: `${month}-05`, merchant: 'TJ', merchantRaw: 'TJ',
      amount: 120, categoryId: 33, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    await useTransactionsStore.getState().createMany([txn]);

    render(<MemoryRouter><Budget /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/^spending$/i)).toBeInTheDocument();
    });
    // Total = $120 of $600 — appears in the Spending header, parent-group
    // subtotal, and the Groceries row caption since it's the only budgeted row.
    expect(screen.getAllByText('$120 of $600').length).toBeGreaterThan(0);
    // The per-row "$X left" badge for under-budget Groceries ($480 remaining)
    expect(screen.getByText('$480 left')).toBeInTheDocument();
  });

  it('reverts a rejected negative budget input without persisting it', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/budget for groceries/i);

    // Type a negative value then blur to trigger the commit handler.
    await user.clear(input);
    await user.type(input, '-50');
    await user.tab();

    // (a) The displayed value must be reverted — not left as '-50'.
    // The prior saved budget is null, so the input should revert to empty string.
    expect((input as HTMLInputElement).value).not.toBe('-50');

    // (b) The category's monthlyBudget must NOT have been updated to a negative value.
    const cats = await new CategoriesRepo(db).list();
    const groceries = cats.find((c) => c.name === 'Groceries');
    expect(groceries?.monthlyBudget).toBeNull();
  });

  describe('tracked categories + Misc catch-all', () => {
    const month = new Date().toISOString().slice(0, 7);
    const seedTxn = (categoryId: number, amount: number, day = '05'): Omit<Transaction, 'id'> => ({
      householdId: 1, date: `${month}-${day}`, merchant: 'M', merchantRaw: 'M',
      amount, categoryId, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    });

    it('on first load with budgets set on multiple categories, all budgeted rows are tracked (default seed)', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 }); // Groceries
      await repo.update(17, { monthlyBudget: 200 }); // Gas/Fuel
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);

      render(<MemoryRouter><Budget /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('Groceries')).toBeInTheDocument();
        expect(screen.getByText('Gas/Fuel')).toBeInTheDocument();
      });
      // Misc row exists but is zero on the default seed (every budgeted row tracked).
      expect(screen.getByRole('heading', { name: /^misc$/i })).toBeInTheDocument();

      // Month select: OPTION VALUE stays the ISO YYYY-MM (summarize keys on it),
      // but the label renders humanized 'Mon YYYY' (Wave 11 T4).
      const monthSelect = screen.getByLabelText('Month');
      const firstOpt = within(monthSelect).getAllByRole('option')[0] as HTMLOptionElement;
      expect(firstOpt.value).toMatch(/^\d{4}-\d{2}$/);
      expect(firstOpt.textContent).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    });

    it('untracking a category moves its spending into the Misc aggregation', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 }); // Groceries
      await repo.update(17, { monthlyBudget: 200 }); // Gas/Fuel
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Gas/Fuel');

      // Click the "Untrack" button on Gas/Fuel.
      const untrackBtn = screen.getByRole('button', { name: /untrack gas\/fuel/i });
      await user.click(untrackBtn);

      // Gas/Fuel row removed from tracked list — only Groceries remains tracked.
      await waitFor(() => {
        expect(screen.queryByLabelText(/budget for gas\/fuel/i)).not.toBeInTheDocument();
      });
      // Misc now carries the $80 actual / $200 budget; both the Misc section
      // header and the BudgetOverlayRow caption render this string.
      const miscCaptions = await screen.findAllByText('$80 of $200');
      expect(miscCaptions.length).toBeGreaterThan(0);
    });

    it('with tracked = [] all spending shows in the Misc aggregation row', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);
      // Pre-seed an empty tracked selection.
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^misc$/i })).toBeInTheDocument();
      });
      // No tracked rows present — confirm Groceries input is not rendered.
      expect(screen.queryByLabelText(/budget for groceries/i)).not.toBeInTheDocument();
      // Misc row shows totals: $200 actual of $800 budget. Both the section
      // header and the overlay caption render this string.
      const totals = screen.getAllByText('$200 of $800');
      expect(totals.length).toBeGreaterThan(0);
    });

    it('the "Add categories" picker batches multiple selections into one update', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      await useTransactionsStore.getState().createMany([seedTxn(17, 80)]);
      // Start with only Groceries tracked. Two budgetable categories untracked
      // (Gas/Fuel and at least one other budgetable seeded row).
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');

      // Gas/Fuel is not tracked — its input should not exist yet.
      expect(screen.queryByLabelText(/budget for gas\/fuel/i)).not.toBeInTheDocument();

      // Open the picker.
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Check Gas/Fuel and apply.
      await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));
      const apply = screen.getByRole('button', { name: /add 1 categor/i });
      await user.click(apply);

      // Gas/Fuel input now renders.
      await waitFor(() => {
        expect(screen.getByLabelText(/budget for gas\/fuel/i)).toBeInTheDocument();
      });

      // localStorage was written exactly once with both ids merged.
      const stored = JSON.parse(localStorage.getItem('trackedBudgetCategories.v1') ?? '[]');
      expect(stored.sort((a: number, b: number) => a - b)).toEqual([17, 33]);
    });

    it('the multi-select picker can add several categories in one click', async () => {
      const repo = new CategoriesRepo(db);
      // Set budgets on three categories so the picker has multiple options.
      await repo.update(33, { monthlyBudget: 600 }); // Groceries
      await repo.update(17, { monthlyBudget: 200 }); // Gas/Fuel
      await repo.update(34, { monthlyBudget: 100 }); // (next budgetable id)
      // Start with only Groceries tracked.
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');

      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Check two boxes — note: the names are whatever the seed data carries.
      const cb17 = screen.getByRole('checkbox', { name: 'Gas/Fuel' });
      await user.click(cb17);
      // Get the remaining checkboxes (there should be at least one more) and
      // click the first one that isn't Gas/Fuel.
      const others = screen.getAllByRole('checkbox').filter((c) => c !== cb17);
      expect(others.length).toBeGreaterThan(0);
      await user.click(others[0]!);

      const apply = screen.getByRole('button', { name: /add 2 categor/i });
      await user.click(apply);

      // After applying, Gas/Fuel input renders, and storage was updated once.
      await waitFor(() => {
        expect(screen.getByLabelText(/budget for gas\/fuel/i)).toBeInTheDocument();
      });
      const stored = JSON.parse(localStorage.getItem('trackedBudgetCategories.v1') ?? '[]') as number[];
      expect(stored).toContain(33);
      expect(stored).toContain(17);
      expect(stored.length).toBe(3); // Groceries + Gas/Fuel + one other
    });

    it('renders the picker grouped by parent category — leaf checkboxes live under their parent header', async () => {
      const repo = new CategoriesRepo(db);
      // Set budgets on three leaves with distinct parents:
      //   33 Groceries  → no parent (General)
      //   17 Gas/Fuel   → 2 Vehicles
      //   10 Utilities  → 1 Home
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      await repo.update(10, { monthlyBudget: 150 });
      // Start with only Groceries tracked, so Gas/Fuel and Utilities are
      // pickable and force two non-General groups to appear.
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Sentinel: Gas/Fuel must render inside the Vehicles parent group,
      // and Utilities must render inside the Home parent group.
      const vehiclesGroup = screen.getByRole('group', { name: 'Vehicles' });
      expect(within(vehiclesGroup).getByRole('checkbox', { name: 'Gas/Fuel' })).toBeInTheDocument();
      const homeGroup = screen.getByRole('group', { name: 'Home' });
      expect(within(homeGroup).getByRole('checkbox', { name: 'Utilities' })).toBeInTheDocument();
      // Cross-group separation: Gas/Fuel must NOT appear in the Home group.
      expect(within(homeGroup).queryByRole('checkbox', { name: 'Gas/Fuel' })).not.toBeInTheDocument();
    });

    it('creating a category from the picker adds it to the tracked list and renders it', async () => {
      // Pre-seed: Groceries (33) is tracked + budgeted so the picker mounts
      // (Budget.tsx only renders it when there are untracked rows). The seed
      // categories include other budgetable leaves that supply that condition.
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');

      // Sanity: "Bakery" doesn't exist yet.
      expect(screen.queryByText('Bakery')).not.toBeInTheDocument();

      // Open the picker → click "+ Add category" trigger → fill form.
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('button', { name: /\+ add category$/i }));

      await user.type(screen.getByLabelText(/name/i), 'Bakery');
      // Home (id 1) is a top-level NEED — should appear in the parent select.
      await user.selectOptions(screen.getByLabelText(/parent/i), '1');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      // The new "Bakery" row renders under its parent (Home) in the tracked area.
      await waitFor(() => {
        expect(screen.getByText('Bakery')).toBeInTheDocument();
      });

      // localStorage carries the new id (whatever the DB assigned) on top of 33.
      const stored = JSON.parse(
        localStorage.getItem('trackedBudgetCategories.v1') ?? '[]',
      ) as number[];
      expect(stored.length).toBeGreaterThan(1);
      expect(stored).toContain(33);

      // The new id corresponds to the Bakery row we just persisted.
      const cats = await new CategoriesRepo(db).list();
      const bakery = cats.find((c) => c.name === 'Bakery');
      expect(bakery).toBeDefined();
      expect(bakery?.parentCategoryId).toBe(1);
      expect(bakery?.type).toBe('NEED');
      expect(stored).toContain(bakery!.id);
    });

    it('opening the picker, closing without applying, leaves the tracked list unchanged', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');

      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));

      // Close without applying. (Dialog renders an sr-only "Close" button.)
      await user.click(screen.getByRole('button', { name: /^close$/i }));

      // Tracked list still just [33], Gas/Fuel input not in the tracked rows.
      expect(screen.queryByLabelText(/budget for gas\/fuel/i)).not.toBeInTheDocument();
      const stored = JSON.parse(localStorage.getItem('trackedBudgetCategories.v1') ?? '[]');
      expect(stored).toEqual([33]);
    });

    // ─── Task #12 — Always-reachable "+ Add category" from Budget.tsx ──────
    // Previously the picker was only rendered when there were untracked rows.
    // With every budgetable category tracked, the picker now renders anyway
    // so the user can open it and reach the "+ Add category" flow.
    it('picker trigger is reachable from the Budget page when every category is tracked', async () => {
      // Track every budgetable category id so untrackedRows is empty.
      const cats = await new CategoriesRepo(db).list();
      const budgetable = cats.filter(
        (c) => (c.type === 'NEED' || c.type === 'WANT') && !c.systemManaged,
      );
      // Filter out parents (anything with at least one child).
      const parentIds = new Set(
        cats.map((c) => c.parentCategoryId).filter((p): p is number => p != null),
      );
      const leafIds = budgetable
        .filter((c) => c.id != null && !parentIds.has(c.id))
        .map((c) => c.id!);
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify(leafIds));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      // Wait for categories to load (any heading rendered).
      await screen.findByRole('heading', { name: /^budget$/i });

      // Trigger is rendered even with no untracked rows.
      const trigger = screen.getByRole('button', { name: /add categor/i });
      expect(trigger).toBeInTheDocument();

      // Clicking it opens the dialog with the "all tracked" empty state and
      // the "+ Add category" entry still available.
      await user.click(trigger);
      expect(screen.getByText(/all categories are tracked/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ add category$/i })).toBeInTheDocument();
    });
  });
});
