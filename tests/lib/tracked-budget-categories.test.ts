import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTrackedBudgetCategories,
  persistTrackedBudgetCategories,
  trackBudgetCategory,
  untrackBudgetCategory,
  hasTrackedBudgetCategoriesSelection,
  TRACKED_BUDGET_CATEGORIES_KEY,
} from '@/lib/tracked-budget-categories';

describe('tracked-budget-categories localStorage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been persisted (signals "use default")', () => {
    expect(getTrackedBudgetCategories()).toBeNull();
    expect(hasTrackedBudgetCategoriesSelection()).toBe(false);
  });

  it('persists and retrieves an array of category ids', () => {
    persistTrackedBudgetCategories([7, 33, 41]);
    expect(localStorage.getItem(TRACKED_BUDGET_CATEGORIES_KEY)).not.toBeNull();
    expect(getTrackedBudgetCategories()).toEqual([7, 33, 41]);
    expect(hasTrackedBudgetCategoriesSelection()).toBe(true);
  });

  it('persists the empty array — distinct from "never set"', () => {
    persistTrackedBudgetCategories([]);
    expect(getTrackedBudgetCategories()).toEqual([]);
    expect(hasTrackedBudgetCategoriesSelection()).toBe(true);
  });

  it('trackBudgetCategory adds an id and is idempotent', () => {
    persistTrackedBudgetCategories([7]);
    trackBudgetCategory(33);
    expect(getTrackedBudgetCategories()).toEqual([7, 33]);
    trackBudgetCategory(33);
    expect(getTrackedBudgetCategories()).toEqual([7, 33]);
  });

  it('untrackBudgetCategory removes an id', () => {
    persistTrackedBudgetCategories([7, 33, 41]);
    untrackBudgetCategory(33);
    expect(getTrackedBudgetCategories()).toEqual([7, 41]);
  });

  it('falls back to null when stored value is malformed', () => {
    localStorage.setItem(TRACKED_BUDGET_CATEGORIES_KEY, '{not json');
    expect(getTrackedBudgetCategories()).toBeNull();
  });

  it('filters out non-numeric entries in stored array (defensive)', () => {
    localStorage.setItem(
      TRACKED_BUDGET_CATEGORIES_KEY,
      JSON.stringify([1, '2', null, 3, true, 4]),
    );
    expect(getTrackedBudgetCategories()).toEqual([1, 3, 4]);
  });
});
