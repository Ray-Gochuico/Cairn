import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import SetupWizard from '@/pages/setup/SetupWizard';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');

async function selectDate(user: UserEvent, pickerId: string, isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split('-');
  const root = screen.getByTestId(`${pickerId}-picker`);
  await user.selectOptions(within(root).getByLabelText('Year'), yyyy);
  await user.selectOptions(within(root).getByLabelText('Month'), mm);
  await user.selectOptions(within(root).getByLabelText('Day'), dd);
}

/**
 * Renders the SetupWizard inside a MemoryRouter that also has a dummy
 * `/` route. After Finish, the wizard navigates to `/` and the dummy
 * route's marker becomes observable — the cleanest way to verify the
 * navigation effect inside RTL without mocking useNavigate.
 */
function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/" element={<div data-testid="dashboard-marker">Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function resetAllStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
}

describe('SetupWizard', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
    ]);
    setDatabase(db);
    resetAllStores();
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders Step 1 (Household) by default and shows the 8-step progress indicator', async () => {
    renderWizard();

    // Header reflects the current step.
    expect(
      await screen.findByText(/Step 1 of 8: Household/i),
    ).toBeInTheDocument();

    // The progress nav lists all 8 step labels.
    expect(screen.getByText(/^1\. Household$/i)).toBeInTheDocument();
    expect(screen.getByText(/^2\. Persons$/i)).toBeInTheDocument();
    expect(screen.getByText(/^3\. Dependents$/i)).toBeInTheDocument();
    expect(screen.getByText(/^4\. Accounts$/i)).toBeInTheDocument();
    expect(screen.getByText(/^5\. Holdings$/i)).toBeInTheDocument();
    expect(screen.getByText(/^6\. Loans$/i)).toBeInTheDocument();
    expect(screen.getByText(/^7\. Property & Vehicles$/i)).toBeInTheDocument();
    expect(screen.getByText(/^8\. Goals$/i)).toBeInTheDocument();
  });

  it('traverses all 8 steps with minimal data and navigates to / on Finish', async () => {
    const user = userEvent.setup();
    renderWizard();

    // --- Step 1: Household ---
    // Household is seeded by migration; load is fired by Step1Household's
    // useEffect. Wait for the form to populate, then nudge a field so the
    // form is dirty and Save & Continue enables.
    await waitFor(() => {
      expect(screen.getByLabelText(/state/i)).toBeInTheDocument();
    });
    const expenseInput = screen.getByLabelText(/monthly expense baseline/i);
    await user.clear(expenseInput);
    await user.type(expenseInput, '5000');
    await user.click(screen.getByRole('button', { name: /save & continue/i }));

    // --- Step 2: Persons ---
    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 8: Persons/i)).toBeInTheDocument();
    });
    // Step2Persons auto-opens the form when persons.length === 0.
    await user.type(screen.getByLabelText(/^name$/i), 'Alex');
    await selectDate(user, 'dateOfBirth', '1990-04-12');
    await user.click(screen.getByRole('button', { name: /^add person$/i }));

    // After person added, the inner "Continue" button enables.
    await waitFor(() => {
      const continueBtn = screen.getByRole('button', { name: /^continue$/i });
      expect(continueBtn).not.toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // --- Step 3: Dependents (skip) ---
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 8: Dependents/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /skip — no dependents/i }));

    // --- Step 4: Accounts (skip) ---
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 8: Accounts/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /skip — no accounts yet/i }));

    // --- Step 5: Holdings (no accounts → just Continue) ---
    await waitFor(() => {
      expect(screen.getByText(/Step 5 of 8: Holdings/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Add accounts in Step 4 to add holdings here/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // --- Step 6: Loans (skip) ---
    await waitFor(() => {
      expect(screen.getByText(/Step 6 of 8: Loans/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /skip — no loans/i }));

    // --- Step 7: Property & Vehicles (skip) ---
    await waitFor(() => {
      expect(
        screen.getByText(/Step 7 of 8: Property & Vehicles/i),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole('button', { name: /skip — no property or vehicles/i }),
    );

    // --- Step 8: Goals → Finish ---
    await waitFor(() => {
      expect(screen.getByText(/Step 8 of 8: Goals/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/all set!/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^finish$/i }));

    // After Finish, the dummy `/` route renders.
    expect(await screen.findByTestId('dashboard-marker')).toBeInTheDocument();
  });
});
