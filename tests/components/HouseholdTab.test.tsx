import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdTab from '@/pages/inputs/HouseholdTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('HouseholdTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
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
