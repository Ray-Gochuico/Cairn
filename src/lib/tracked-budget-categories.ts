/**
 * Persists the user's selection of which budgetable categories are tracked
 * on the Budget page (rendered with overlay bars at the top). Anything not
 * tracked is rolled into the synthetic "Other / Misc" row.
 *
 * Storage is localStorage, matching the precedent of `calculator-visibility`.
 * `null` means "no selection has ever been made" — callers should treat that
 * as a signal to seed the tracked set from whatever categories currently
 * have a non-null `monthlyBudget`, preserving the prior Mint-style behavior.
 */
export const TRACKED_BUDGET_CATEGORIES_KEY = 'trackedBudgetCategories.v1';

export function getTrackedBudgetCategories(): number[] | null {
  try {
    const raw = localStorage.getItem(TRACKED_BUDGET_CATEGORIES_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  } catch {
    return null;
  }
}

export function hasTrackedBudgetCategoriesSelection(): boolean {
  try {
    return localStorage.getItem(TRACKED_BUDGET_CATEGORIES_KEY) != null;
  } catch {
    return false;
  }
}

export function persistTrackedBudgetCategories(ids: readonly number[]): void {
  try {
    localStorage.setItem(TRACKED_BUDGET_CATEGORIES_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode / quota / SSR); the in-memory state
    // still updates so the UI behaves correctly within the session.
  }
}

export function trackBudgetCategory(id: number): void {
  const current = getTrackedBudgetCategories() ?? [];
  if (current.includes(id)) return;
  persistTrackedBudgetCategories([...current, id]);
}

// Append a batch of ids in one write. Empty batches are a no-op so that
// opening + closing the picker without selecting anything does not collapse
// the "never set" sentinel to an empty array.
export function trackBudgetCategories(ids: readonly number[]): void {
  if (ids.length === 0) return;
  const current = getTrackedBudgetCategories() ?? [];
  const merged = [...current];
  for (const id of ids) {
    if (!merged.includes(id)) merged.push(id);
  }
  persistTrackedBudgetCategories(merged);
}

export function untrackBudgetCategory(id: number): void {
  const current = getTrackedBudgetCategories() ?? [];
  persistTrackedBudgetCategories(current.filter((x) => x !== id));
}
