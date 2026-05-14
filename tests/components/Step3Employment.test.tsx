import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonsRepo } from '@/domain/persons';
import Step3Employment from '@/pages/setup/Step3Employment';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');

async function seedPerson(
  db: SqliteAdapter,
  name: string,
  overrides: { employmentType?: 'HOURLY' | 'SALARY_NO_OT' | 'SALARY_WITH_OT' } = {},
): Promise<number> {
  const repo = new PersonsRepo(db);
  return repo.create({
    householdId: 1,
    name,
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: overrides.employmentType ?? 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  });
}

describe('Step3Employment', () => {
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

  it('renders an empty state when no persons exist', async () => {
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/add a person in the previous step first/i),
      ).toBeInTheDocument();
    });
  });

  it('renders an employment type selector with three options for each person', async () => {
    await seedPerson(db, 'Alex');
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/employment type/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(['HOURLY', 'SALARY_NO_OT', 'SALARY_WITH_OT']),
    );
    // Visible labels for all three.
    expect(within(select).getByText(/^hourly$/i)).toBeInTheDocument();
    expect(within(select).getByText(/salaried.*no overtime/i)).toBeInTheDocument();
    expect(within(select).getByText(/salaried with overtime/i)).toBeInTheDocument();
  });

  it('shows hourly-rate input only when Hourly is selected', async () => {
    await seedPerson(db, 'Alex');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    // Default seeded as SALARY_NO_OT — no hourly fields visible.
    expect(screen.queryByLabelText(/hourly rate/i)).not.toBeInTheDocument();

    // Switch to HOURLY.
    await user.selectOptions(screen.getByLabelText(/employment type/i), 'HOURLY');
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/regular hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ot threshold/i)).toBeInTheDocument();
    // Annual salary hidden when HOURLY.
    expect(screen.queryByLabelText(/annual salary/i)).not.toBeInTheDocument();
  });

  it('shows both annual salary and hourly fields when SALARY_WITH_OT is selected', async () => {
    await seedPerson(db, 'Alex');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByLabelText(/employment type/i),
      'SALARY_WITH_OT',
    );

    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/regular hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ot threshold/i)).toBeInTheDocument();
    // Annual salary shown alongside hourly fields for SALARY_WITH_OT.
    expect(screen.getByLabelText(/annual salary/i)).toBeInTheDocument();
  });

  it('saves the employment type on Save and updates the persons store', async () => {
    await seedPerson(db, 'Alex');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/employment type/i), 'HOURLY');
    await user.clear(screen.getByLabelText(/hourly rate/i));
    await user.type(screen.getByLabelText(/hourly rate/i), '42.5');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { persons } = usePersonsStore.getState();
      expect(persons[0].employmentType).toBe('HOURLY');
      expect(persons[0].hourlyRate).toBe(42.5);
    });
  });

  it('renders one editable block per person when multiple persons exist', async () => {
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Jordan', { employmentType: 'SALARY_WITH_OT' });
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
      expect(screen.getByText(/Jordan/)).toBeInTheDocument();
    });

    // Two employment-type selects, one per person.
    expect(screen.getAllByLabelText(/employment type/i)).toHaveLength(2);
  });

  it('saves only the targeted person when multiple persons exist (per-card personId routing)', async () => {
    const alexId = await seedPerson(db, 'Alex');
    const jordanId = await seedPerson(db, 'Jordan');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
      expect(screen.getByText(/Jordan/)).toBeInTheDocument();
    });

    // Scope edits + Save click to Jordan's card via the testid.
    const jordanCard = screen.getByTestId(`employment-card-${jordanId}`);
    await user.selectOptions(
      within(jordanCard).getByLabelText(/employment type/i),
      'HOURLY',
    );
    const hourlyRate = within(jordanCard).getByLabelText(/hourly rate/i);
    await user.clear(hourlyRate);
    await user.type(hourlyRate, '55');
    await user.click(within(jordanCard).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { persons } = usePersonsStore.getState();
      const jordan = persons.find((p) => p.id === jordanId);
      const alex = persons.find((p) => p.id === alexId);
      expect(jordan?.employmentType).toBe('HOURLY');
      expect(jordan?.hourlyRate).toBe(55);
      // Alex untouched — still the seeded SALARY_NO_OT, no hourly rate.
      expect(alex?.employmentType).toBe('SALARY_NO_OT');
      expect(alex?.hourlyRate).toBeNull();
    });
  });

  it('shows an inline error and does not save when annual salary is cleared', async () => {
    await seedPerson(db, 'Alex');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    // Clear the required annual-salary input and Save.
    await user.clear(screen.getByLabelText(/annual salary/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Inline error surfaces.
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
    // Persisted record still has the original $100,000 — empty input did
    // not silently coerce to 0.
    const { persons } = usePersonsStore.getState();
    expect(persons[0].annualSalaryPretax).toBe(100000);
  });

  it('shows an inline error when regular hours / week is cleared on an HOURLY person', async () => {
    await seedPerson(db, 'Alex', { employmentType: 'HOURLY' });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Alex/)).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/regular hours/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
  });

  it('Continue calls onComplete', async () => {
    await seedPerson(db, 'Alex');
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={onComplete} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('Skip on empty-state calls onComplete', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Step3Employment onComplete={onComplete} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/add a person in the previous step first/i),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
