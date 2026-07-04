import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonsRepo } from '@/domain/persons';
import PersonsTab from '@/pages/inputs/PersonsTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function seedPerson(db: SqliteAdapter, name: string): Promise<number> {
  const repo = new PersonsRepo(db);
  return repo.create({
    householdId: 1,
    name,
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  });
}

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');

async function selectDate(user: UserEvent, pickerId: string, isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split('-');
  const root = screen.getByTestId(`${pickerId}-picker`);
  await user.selectOptions(within(root).getByLabelText(/year$/i), yyyy);
  await user.selectOptions(within(root).getByLabelText(/month$/i), mm);
  await user.selectOptions(within(root).getByLabelText(/day$/i), dd);
}

describe('PersonsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
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
    expect(screen.getByRole('group', { name: /date of birth/i })).toBeInTheDocument();
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

  describe('delete confirmation (high-cascade)', () => {
    it('clicking Delete opens a confirm dialog naming the collateral and does NOT remove yet', async () => {
      await seedPerson(db, 'Alex');
      const user = userEvent.setup();
      render(<MemoryRouter><PersonsTab /></MemoryRouter>);

      await screen.findByText('Alex');
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(usePersonsStore.getState().persons).toHaveLength(1);
      expect(await screen.findByText(/delete alex\?/i)).toBeInTheDocument();
      expect(screen.getByText(/equity grants/i)).toBeInTheDocument();
    });

    it('Cancel keeps the person; Confirm removes them', async () => {
      await seedPerson(db, 'Alex');
      const user = userEvent.setup();
      render(<MemoryRouter><PersonsTab /></MemoryRouter>);

      await screen.findByText('Alex');
      // Cancel path
      await user.click(screen.getByRole('button', { name: /^delete$/i }));
      await screen.findByText(/delete alex\?/i);
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() =>
        expect(screen.queryByText(/delete alex\?/i)).not.toBeInTheDocument(),
      );
      expect(usePersonsStore.getState().persons).toHaveLength(1);

      // Confirm path
      await user.click(screen.getByRole('button', { name: /^delete$/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(usePersonsStore.getState().persons).toHaveLength(0),
      );
    });
  });
});
