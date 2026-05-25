import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTrackedBudgetCategories,
  persistTrackedBudgetCategories,
  trackBudgetCategory,
  trackBudgetCategories,
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

  it('trackBudgetCategories appends a batch atomically and de-duplicates', () => {
    persistTrackedBudgetCategories([7]);
    trackBudgetCategories([33, 41, 7]); // 7 is already tracked → dedupe
    expect(getTrackedBudgetCategories()).toEqual([7, 33, 41]);
  });

  it('trackBudgetCategories on a never-set selection seeds from []', () => {
    // hasTrackedBudgetCategoriesSelection() === false before the call.
    expect(hasTrackedBudgetCategoriesSelection()).toBe(false);
    trackBudgetCategories([5, 9]);
    expect(getTrackedBudgetCategories()).toEqual([5, 9]);
    expect(hasTrackedBudgetCategoriesSelection()).toBe(true);
  });

  it('trackBudgetCategories with an empty batch is a no-op (does not write)', () => {
    // Pre: nothing persisted.
    trackBudgetCategories([]);
    // Still treated as "never set" — no write was made.
    expect(hasTrackedBudgetCategoriesSelection()).toBe(false);
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
