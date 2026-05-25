import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';

export interface BudgetRow {
  categoryId: number;
  categoryName: string;
  parentCategoryId: number | null;
  budget: number | null;     // monthly_budget; null = unbudgeted
  actual: number;            // real spending in the selected month
  remaining: number | null;  // budget - actual, when a budget is set
  pct: number | null;        // actual / budget, when budget > 0
  overBudget: boolean;
}

export interface BudgetSummary {
  month: string;             // YYYY-MM
  rows: BudgetRow[];         // one per budgetable category
  totalBudget: number;       // sum of set budgets
  totalActual: number;       // sum of actuals across budgetable categories
}

/**
 * A category is budgetable if it is a leaf (no other category names it as
 * parent), spendable (type NEED or WANT), and not system-managed. Parent
 * categories are display-only headers; INCOME/TRANSFER and loan-routed
 * system categories are never budget targets.
 */
export function budgetableCategories(categories: Category[]): Category[] {
  const parentIds = new Set(
    categories
      .map((c) => c.parentCategoryId)
      .filter((p): p is number => p != null),
  );
  return categories.filter(
    (c) =>
      c.id != null &&
      !parentIds.has(c.id) &&
      (c.type === 'NEED' || c.type === 'WANT') &&
      !c.systemManaged,
  );
}

export interface GroupedPickerOption {
  id: number;
  name: string;
}

export interface ParentGroup {
  /** null when the leaf has no parent (or its parent id is unknown). */
  parentId: number | null;
  /** Display name; 'General' for the null-parent fallback. */
  parentName: string;
  options: GroupedPickerOption[];
}

/**
 * Group leaf categories by their parent for grouped multi-select rendering.
 * Leaves whose parentCategoryId is null (or points at an unknown id) collapse
 * into a single 'General' group keyed by parentId=null. Groups are sorted
 * alphabetically by parent name; options within each group are sorted by name.
 *
 * Pass any leaf list — typically `budgetableCategories(...)` or a subset
 * filtered to those the picker should show.
 */
export function groupByParent(
  allCategories: Category[],
  leafCategories: Category[],
): ParentGroup[] {
  const nameById = new Map<number, string>();
  for (const c of allCategories) {
    if (c.id != null) nameById.set(c.id, c.name);
  }

  const byKey = new Map<string, ParentGroup>();
  for (const leaf of leafCategories) {
    if (leaf.id == null) continue;
    const pid = leaf.parentCategoryId;
    const hasKnownParent = pid != null && nameById.has(pid);
    const resolvedParentId = hasKnownParent ? pid : null;
    const parentName = hasKnownParent ? nameById.get(pid)! : 'General';
    const key = resolvedParentId == null ? '__general__' : String(resolvedParentId);
    let group = byKey.get(key);
    if (group == null) {
      group = { parentId: resolvedParentId, parentName, options: [] };
      byKey.set(key, group);
    }
    group.options.push({ id: leaf.id, name: leaf.name });
  }

  const groups = [...byKey.values()];
  for (const g of groups) g.options.sort((a, b) => a.name.localeCompare(b.name));
  groups.sort((a, b) => a.parentName.localeCompare(b.parentName));
  return groups;
}

/** Budget-vs-actual for one month across every budgetable category. */
export function summarizeBudget(
  categories: Category[],
  transactions: Transaction[],
  month: string,
): BudgetSummary {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);

  // Actual real spending per category id, restricted to `month`.
  const actualByCat = new Map<number, number>();
  for (const t of transactions) {
    if (t.date.slice(0, 7) !== month) continue;
    if (t.categoryId == null) continue;
    if (!isRealSpending(t, byId)) continue;
    actualByCat.set(
      t.categoryId,
      (actualByCat.get(t.categoryId) ?? 0) + effectiveSpendingAmount(t),
    );
  }

  const rows: BudgetRow[] = budgetableCategories(categories).map((c) => {
    const categoryId = c.id as number;
    const actual = actualByCat.get(categoryId) ?? 0;
    const budget = c.monthlyBudget;
    return {
      categoryId,
      categoryName: c.name,
      parentCategoryId: c.parentCategoryId,
      budget,
      actual,
      remaining: budget != null ? budget - actual : null,
      pct: budget != null && budget > 0 ? actual / budget : null,
      overBudget: budget != null && actual > budget,
    };
  });

  return {
    month,
    rows,
    totalBudget: rows.reduce((s, r) => s + (r.budget ?? 0), 0),
    totalActual: rows.reduce((s, r) => s + r.actual, 0),
  };
}

/**
 * Sentinel id for the synthetic "Misc" catch-all row. Negative so it
 * cannot collide with any real category primary key.
 *
 * Note: "Misc" — not "Other" — because the seeded category set already
 * contains a real "Other" leaf (id 42).
 */
export const MISC_CATEGORY_ID = -1;
export const MISC_CATEGORY_NAME = 'Misc';

export interface TrackedPartition {
  tracked: BudgetRow[];
  misc: BudgetRow;
}

/**
 * Split rows into the user's selected (tracked) set and a single Misc row
 * that aggregates every other row's spending and budget. Tracked rows are
 * returned in the order they appear in `rows` (already grouped by parent).
 */
export function partitionTrackedRows(
  rows: BudgetRow[],
  trackedIds: readonly number[],
): TrackedPartition {
  const trackedSet = new Set(trackedIds);
  const tracked: BudgetRow[] = [];
  let miscBudget = 0;
  let miscActual = 0;
  let anyUntrackedBudgeted = false;

  for (const r of rows) {
    if (trackedSet.has(r.categoryId)) {
      tracked.push(r);
    } else {
      if (r.budget != null) {
        miscBudget += r.budget;
        anyUntrackedBudgeted = true;
      }
      miscActual += r.actual;
    }
  }

  const miscBudgetFinal = anyUntrackedBudgeted ? miscBudget : 0;
  const misc: BudgetRow = {
    categoryId: MISC_CATEGORY_ID,
    categoryName: MISC_CATEGORY_NAME,
    parentCategoryId: null,
    budget: miscBudgetFinal,
    actual: miscActual,
    remaining: miscBudgetFinal - miscActual,
    pct: miscBudgetFinal > 0 ? miscActual / miscBudgetFinal : null,
    overBudget: miscActual > miscBudgetFinal,
  };

  return { tracked, misc };
}
