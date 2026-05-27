import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdTab from '@/pages/inputs/HouseholdTab';

describe('HouseholdTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Full migration chain — HouseholdRepo.update() references 0018
    // roadmap rule-engine columns (W7-R1).
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders form fields after loading', async () => {
    render(<MemoryRouter><HouseholdTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByLabelText(/filing status/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/state/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/monthly expense baseline/i)).toBeInTheDocument();
    });
  });

  it('updates household when form is submitted', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><HouseholdTab /></MemoryRouter>);
    await waitFor(() => screen.getByLabelText(/state/i));

    const stateInput = screen.getByLabelText(/state/i) as HTMLInputElement;
    await user.clear(stateInput);
    await user.type(stateInput, 'WA');

    const expenseInput = screen.getByLabelText(/monthly expense baseline/i) as HTMLInputElement;
    await user.clear(expenseInput);
    await user.type(expenseInput, '6500');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      const { household } = useHouseholdStore.getState();
      expect(household!.state).toBe('WA');
      expect(household!.monthlyExpenseBaseline).toBe(6500);
    });
  });
});
