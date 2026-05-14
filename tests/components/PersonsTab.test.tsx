import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePersonsStore } from '@/stores/persons-store';
import PersonsTab from '@/pages/inputs/PersonsTab';
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

describe('PersonsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
    ]);
    setDatabase(db);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no persons exist', async () => {
    render(<MemoryRouter><PersonsTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no persons added yet/i)).toBeInTheDocument();
    });
  });

  it('opens the add-person form when clicking Add Person', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PersonsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add person/i }));
    await user.click(screen.getByRole('button', { name: /add person/i }));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
  });

  it('creates a person via the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PersonsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add person/i }));
    await user.click(screen.getByRole('button', { name: /add person/i }));

    await user.type(screen.getByLabelText(/name/i), 'Alex');
    await selectDate(user, 'dateOfBirth', '1988-03-15');
    await user.clear(screen.getByLabelText(/target retirement age/i));
    await user.type(screen.getByLabelText(/target retirement age/i), '55');
    await user.clear(screen.getByLabelText(/annual salary/i));
    await user.type(screen.getByLabelText(/annual salary/i), '140000');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { persons } = usePersonsStore.getState();
      expect(persons).toHaveLength(1);
      expect(persons[0].name).toBe('Alex');
    });
  });
});
