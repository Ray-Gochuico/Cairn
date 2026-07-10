/**
 * Layout smoke tests for the Inputs tabs flagged in
 * docs/reviews/2026-05-26-ux-review.md finding #1.
 *
 * Goal: prove the row containers won't blow up sideways at narrow
 * widths. Strict pixel-overflow detection is unreliable under jsdom
 * (no real layout engine), so we assert the structural guards that
 * cause the overflow in the first place:
 *
 *   - the row's title container has `min-w-0 flex-1`
 *   - the row's action cluster has `shrink-0`
 *   - the title text uses `truncate` for long-value cells
 *
 * Together these mean a wider label can't push the buttons off the
 * card or stack one-word-per-line at narrow widths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase, getDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useHouseholdStore } from '@/stores/household-store';
import { PersonsRepo } from '@/domain/persons';
import { TickersRepo } from '@/domain/tickers';
import CategoriesTab from '@/pages/inputs/CategoriesTab';
import PersonsTab from '@/pages/inputs/PersonsTab';
import TickersPanel from '@/components/investments/manage/TickersPanel';
import HouseholdTab from '@/pages/inputs/HouseholdTab';
import InputsLayout from '@/pages/inputs/InputsLayout';
import { AssetClass, Direction } from '@/types/schema';

function assertCompactRow(row: HTMLElement) {
  // The row's outer card-content flex container should gap its children so
  // the buttons cluster has horizontal breathing room from the title.
  const flex = row.querySelector('[class*="flex"][class*="justify-between"]') as HTMLElement | null;
  expect(flex, 'expected flex row container').not.toBeNull();
  expect(flex!.className).toMatch(/gap-/);

  // The title container needs `min-w-0` + `flex-1` so it shrinks to fit;
  // the action cluster needs `shrink-0` so it doesn't get squeezed off-card.
  const title = flex!.querySelector('[class*="min-w-0"][class*="flex-1"]');
  expect(title, 'expected min-w-0 flex-1 title container').not.toBeNull();

  // At least one descendant carries shrink-0 (the buttons cluster).
  const shrinkSafeNodes = flex!.querySelectorAll('[class*="shrink-0"]');
  expect(shrinkSafeNodes.length).toBeGreaterThan(0);
}

describe('Inputs layout smoke — cramped-row fix', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Use loadAllMigrations() instead of a hand-curated subset so that
    // schema additions in future migrations don't silently break this
    // file. See docs/reviews/2026-05-27-testing-rereview.md finding N3
    // ("InputsLayoutSmoke.test.tsx reintroduces the hand-curated-
    // migrations anti-pattern").
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useTickersStore.setState({ tickers: [], isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('CategoriesTab row has min-w-0 / shrink-0 / gap container', async () => {
    render(
      <MemoryRouter>
        <CategoriesTab />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // First non-system-managed seeded row will have Edit/Delete buttons.
      const rows = screen.queryAllByTestId('categories-row');
      expect(rows.length).toBeGreaterThan(0);
    });
    const row = screen.getAllByTestId('categories-row')[0];
    assertCompactRow(row);
  });

  it('PersonsTab row has min-w-0 / shrink-0 / truncate container', async () => {
    // Seed a single person with a long-ish name + max-length salary so
    // the row would overflow without the fix.
    const repo = new PersonsRepo(getDatabase());
    await repo.create({
      householdId: 1,
      name: 'Alexandra Featherstone-Hawthorne',
      dateOfBirth: '1990-06-15',
      targetRetirementAge: 65,
      annualSalaryPretax: 1234567,
      expectedBonus: 0,
      expectedBonusFrequency: 'ANNUAL',
      bonusIsConsistent: true,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      employmentType: 'SALARY_NO_OT',
      hourlyRate: null,
      regularHoursPerWeek: 40,
      otThresholdHoursPerWeek: null,
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    });

    render(
      <MemoryRouter>
        <PersonsTab />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('persons-row')).toBeInTheDocument();
    });
    const row = screen.getByTestId('persons-row');
    assertCompactRow(row);
    // Title text uses truncate so long names won't push buttons off.
    expect(row.querySelector('[class*="truncate"]')).not.toBeNull();
  });

  it('TickersPanel row has min-w-0 / shrink-0 / truncate container (W14: tab retired)', async () => {
    // Seed a ticker with a long name so we exercise the truncate path.
    const repo = new TickersRepo(getDatabase());
    await repo.upsert({
      ticker: 'AAL',
      name: 'American Airlines Group Inc',
      assetClass: AssetClass.SINGLE_STOCK,
      leverageFactor: 1.0,
      direction: Direction.LONG,
      userAdded: true,
      accentColor: null,
      sector: null,
      industry: null,
    });

    render(
      <MemoryRouter>
        <TickersPanel />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryAllByTestId('tickers-row').length).toBeGreaterThan(0);
    });
    const row = screen.getAllByTestId('tickers-row')[0];
    assertCompactRow(row);
    expect(row.querySelector('[class*="truncate"]')).not.toBeNull();
  });

  it('the tab rail is a named Setup landmark with exactly the four residual tabs (W14)', () => {
    render(
      <MemoryRouter>
        <InputsLayout />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Setup' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Household',
      'Persons',
      'Dependents',
      'Categories',
    ]);
  });

  it('HouseholdTab content wrapper carries min-w-0 so long labels can break', async () => {
    render(
      <MemoryRouter>
        <HouseholdTab />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('household-tab')).toBeInTheDocument();
    });
    const tab = screen.getByTestId('household-tab');
    expect(tab.className).toMatch(/min-w-0/);
  });
});
