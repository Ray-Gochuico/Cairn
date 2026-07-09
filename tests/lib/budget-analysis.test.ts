import { describe, it, expect } from 'vitest';
import {
  summarizeBudget,
  budgetableCategories,
  groupByParent,
  partitionTrackedRows,
  MISC_CATEGORY_ID,
} from '@/lib/budget-analysis';
import type { BudgetRow } from '@/lib/budget-analysis';
import type { Transaction, Category } from '@/types/schema';

const cat = (over: Partial<Category> & { id: number }): Category => ({
  name: `c${over.id}`, parentCategoryId: null, color: null, icon: null,
  type: 'WANT', isCapital: false, systemManaged: false, monthlyBudget: null, ...over,
});
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 1, householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X', amount: 10,
  categoryId: 33, sourceAccountId: null, propertyId: null, vehicleId: null, personId: null,
  sourcePdfFilename: null, reimbursable: false, reimbursedAt: null, reimbursedAmount: null,
  isRecurring: false, notes: null, ...over,
});

// 1 = Home (parent), 7 = Maintenance (Home child, NEED), 33 = Groceries (NEED standalone),
// 40 = Income (INCOME), 50 = Mortgage Principal (system-managed leaf under Home)
const categories: Category[] = [
  cat({ id: 1, name: 'Home', type: 'NEED' }),
  cat({ id: 7, name: 'Maintenance', parentCategoryId: 1, type: 'NEED', monthlyBudget: 200 }),
  cat({ id: 33, name: 'Groceries', type: 'NEED', monthlyBudget: 600 }),
  cat({ id: 40, name: 'Income', type: 'INCOME' }),
  cat({ id: 50, name: 'Mortgage Principal', parentCategoryId: 1, type: 'NEED', systemManaged: true }),
];

describe('budgetableCategories', () => {
  it('keeps leaf NEED/WANT non-system categories, drops parents/income/system rows', () => {
    const ids = budgetableCategories(categories).map((c) => c.id).sort((a, b) => a! - b!);
    expect(ids).toEqual([7, 33]); // not 1 (parent), not 40 (INCOME), not 50 (system)
  });
});

describe('groupByParent', () => {
  // 1 = Home (parent), 2 = Vehicles (parent), 7 = Maintenance (Home child),
  // 17 = Gas/Fuel (Vehicles child), 33 = Groceries (no parent — General).
  const parents: Category[] = [
    cat({ id: 1, name: 'Home', type: 'NEED' }),
    cat({ id: 2, name: 'Vehicles', type: 'NEED' }),
  ];
  const home1 = cat({ id: 7, name: 'Maintenance', parentCategoryId: 1, type: 'NEED' });
  const home2 = cat({ id: 10, name: 'Utilities', parentCategoryId: 1, type: 'NEED' });
  const vehicle1 = cat({ id: 17, name: 'Gas/Fuel', parentCategoryId: 2, type: 'NEED' });
  const standalone = cat({ id: 33, name: 'Groceries', type: 'NEED' });

  it('groups leaves by their parent category and surfaces the parent name', () => {
    const groups = groupByParent([...parents, home1, home2, vehicle1, standalone], [home1, home2, vehicle1, standalone]);
    const home = groups.find((g) => g.parentId === 1);
    expect(home?.parentName).toBe('Home');
    expect(home?.options.map((o) => o.name).sort()).toEqual(['Maintenance', 'Utilities']);
    const vehicles = groups.find((g) => g.parentId === 2);
    expect(vehicles?.parentName).toBe('Vehicles');
    expect(vehicles?.options.map((o) => o.name)).toEqual(['Gas/Fuel']);
  });

  it('places leaves with no parent into a "General" group with parentId=null', () => {
    const groups = groupByParent([...parents, home1, standalone], [home1, standalone]);
    const general = groups.find((g) => g.parentId === null);
    expect(general).toBeDefined();
    expect(general?.parentName).toBe('General');
    expect(general?.options.map((o) => o.name)).toEqual(['Groceries']);
  });

  it('returns groups sorted alphabetically by parent name', () => {
    const groups = groupByParent([...parents, home1, vehicle1, standalone], [home1, vehicle1, standalone]);
    expect(groups.map((g) => g.parentName)).toEqual(['General', 'Home', 'Vehicles']);
  });

  it('returns an empty array when no leaves are provided', () => {
    expect(groupByParent(parents, [])).toEqual([]);
  });

  it('falls back to "General" when a leaf references an unknown parent id', () => {
    const orphan = cat({ id: 99, name: 'Orphan', parentCategoryId: 9999, type: 'NEED' });
    const groups = groupByParent([...parents, orphan], [orphan]);
    const general = groups.find((g) => g.parentName === 'General');
    expect(general?.options.map((o) => o.name)).toEqual(['Orphan']);
  });

  it('sorts options within a group alphabetically by name', () => {
    const groups = groupByParent([...parents, home2, home1], [home2, home1]);
    const home = groups.find((g) => g.parentId === 1);
    expect(home?.options.map((o) => o.name)).toEqual(['Maintenance', 'Utilities']);
  });
});

describe('summarizeBudget', () => {
  it('computes actual, remaining, pct, and overBudget for the given month', () => {
    const txns = [
      txn({ id: 1, date: '2026-03-04', categoryId: 33, amount: 700 }), // Groceries, over
      txn({ id: 2, date: '2026-03-09', categoryId: 7, amount: 50 }),   // Maintenance, under
      txn({ id: 3, date: '2026-02-15', categoryId: 33, amount: 999 }), // wrong month — ignored
    ];
    const s = summarizeBudget(categories, txns, '2026-03');
    const groceries = s.rows.find((r) => r.categoryId === 33)!;
    expect(groceries.actual).toBe(700);
    expect(groceries.remaining).toBe(-100);
    expect(groceries.overBudget).toBe(true);
    expect(groceries.pct).toBeCloseTo(700 / 600);
    const maint = s.rows.find((r) => r.categoryId === 7)!;
    expect(maint.actual).toBe(50);
    expect(maint.overBudget).toBe(false);
    expect(s.totalBudget).toBe(800);
    expect(s.totalActual).toBe(750);
  });

  it('counts a reimbursed transaction at its net out-of-pocket amount', () => {
    const txns = [
      txn({ id: 1, date: '2026-03-04', categoryId: 33, amount: 200,
        reimbursable: true, reimbursedAt: '2026-03-20', reimbursedAmount: 150 }),
    ];
    const s = summarizeBudget(categories, txns, '2026-03');
    expect(s.rows.find((r) => r.categoryId === 33)!.actual).toBe(50);
  });
});

describe('partitionTrackedRows', () => {
  const mkRow = (over: Partial<BudgetRow> & { categoryId: number }): BudgetRow => ({
    categoryName: `cat${over.categoryId}`,
    parentCategoryId: null,
    budget: 100,
    actual: 50,
    remaining: 50,
    pct: 0.5,
    overBudget: false,
    ...over,
  });

  it('returns every row in tracked when every categoryId is selected, with a zero-actual misc row', () => {
    const rows = [
      mkRow({ categoryId: 7, budget: 200, actual: 80, remaining: 120, pct: 0.4 }),
      mkRow({ categoryId: 33, budget: 600, actual: 700, remaining: -100, pct: 700 / 600, overBudget: true }),
    ];
    const { tracked, misc } = partitionTrackedRows(rows, [7, 33]);
    expect(tracked.map((r) => r.categoryId)).toEqual([7, 33]);
    expect(misc.categoryId).toBe(MISC_CATEGORY_ID);
    expect(misc.actual).toBe(0);
    expect(misc.budget).toBe(0);
  });

  it('aggregates non-tracked rows into the misc row (budget + actual sums)', () => {
    const rows = [
      mkRow({ categoryId: 7, budget: 200, actual: 80, remaining: 120, pct: 0.4 }),
      mkRow({ categoryId: 33, budget: 600, actual: 700, remaining: -100, pct: 700 / 600, overBudget: true }),
      mkRow({ categoryId: 41, budget: 50, actual: 30, remaining: 20, pct: 0.6 }),
    ];
    // Track only 7; 33 and 41 collapse into misc.
    const { tracked, misc } = partitionTrackedRows(rows, [7]);
    expect(tracked.map((r) => r.categoryId)).toEqual([7]);
    expect(misc.actual).toBe(700 + 30); // 730
    expect(misc.budget).toBe(600 + 50);  // 650
    expect(misc.remaining).toBe(650 - 730); // -80
    expect(misc.overBudget).toBe(true);
  });

  it('puts every row into misc when the tracked list is empty', () => {
    const rows = [
      mkRow({ categoryId: 7, budget: 200, actual: 80, remaining: 120, pct: 0.4 }),
      mkRow({ categoryId: 33, budget: 600, actual: 700, remaining: -100, pct: 700 / 600, overBudget: true }),
    ];
    const { tracked, misc } = partitionTrackedRows(rows, []);
    expect(tracked).toEqual([]);
    expect(misc.actual).toBe(780);
    expect(misc.budget).toBe(800);
    expect(misc.remaining).toBe(20);
    expect(misc.overBudget).toBe(false);
  });

  it('skips unbudgeted (budget=null) rows when summing the misc budget but still adds actuals', () => {
    const rows = [
      mkRow({ categoryId: 7, budget: 200, actual: 80, remaining: 120, pct: 0.4 }),
      mkRow({ categoryId: 33, budget: null, actual: 90, remaining: null, pct: null }),
    ];
    const { misc } = partitionTrackedRows(rows, []);
    expect(misc.budget).toBe(200);
    expect(misc.actual).toBe(170);
    expect(misc.remaining).toBe(30);
  });

  it('omits tracked entries that do not appear in rows (e.g. category since deleted)', () => {
    const rows = [
      mkRow({ categoryId: 7, budget: 200, actual: 80, remaining: 120, pct: 0.4 }),
    ];
    const { tracked, misc } = partitionTrackedRows(rows, [7, 9999]);
    expect(tracked.map((r) => r.categoryId)).toEqual([7]);
    expect(misc.actual).toBe(0);
  });
});

describe('parent-categorized spending (wave-9 M6)', () => {
  const parentCats: Category[] = [
    cat({ id: 1, name: 'Food', type: 'NEED' }),
    cat({ id: 2, name: 'Groceries', parentCategoryId: 1, type: 'NEED', monthlyBudget: 400 }),
  ];

  it('a parent-categorized transaction lands in a synthesized row and totalActual', () => {
    const s = summarizeBudget(parentCats, [txn({ categoryId: 1, amount: 120, date: '2026-07-03' })], '2026-07');
    expect(s.totalActual).toBe(120);
    const parentRow = s.rows.find((r) => r.categoryId === 1);
    expect(parentRow).toBeDefined();
    expect(parentRow!.actual).toBe(120);
  });

  it('the synthesized parent row rolls into Misc when untracked', () => {
    const s = summarizeBudget(parentCats, [txn({ categoryId: 1, amount: 120, date: '2026-07-03' })], '2026-07');
    const partition = partitionTrackedRows(s.rows, [2]);
    expect(partition.misc.actual).toBe(120);
  });

  it('parents with no in-month actuals synthesize NO row (rows stay leaf-only)', () => {
    const s = summarizeBudget(parentCats, [], '2026-07');
    expect(s.rows.every((r) => r.categoryId !== 1)).toBe(true);
  });
});
