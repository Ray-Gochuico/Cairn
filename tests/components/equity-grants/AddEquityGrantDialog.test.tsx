import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setDatabase } from '@/db/db';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonsRepo } from '@/domain/persons';
import AddEquityGrantDialog from '@/components/equity-grants/AddEquityGrantDialog';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');
const loadEquityGrantCompanyValuationMigration = () =>
  readFileSync(resolve(__dirname, '../../../src/db/migrations/0027_equity_grant_company_valuation.sql'), 'utf-8');
const loadEquityGrantTypeMigration = () =>
  readFileSync(resolve(__dirname, '../../../src/db/migrations/0044_equity_grant_type.sql'), 'utf-8');

async function selectDate(user: UserEvent, pickerId: string, isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split('-');
  const root = screen.getByTestId(`${pickerId}-picker`);
  await user.selectOptions(within(root).getByLabelText('Year'), yyyy);
  await user.selectOptions(within(root).getByLabelText('Month'), mm);
  await user.selectOptions(within(root).getByLabelText('Day'), dd);
}

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

describe('AddEquityGrantDialog', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0027_equity_grant_company_valuation', sql: loadEquityGrantCompanyValuationMigration() },
      { version: '0044_equity_grant_type', sql: loadEquityGrantTypeMigration() },
    ]);
    setDatabase(db);
    useEquityGrantsStore.setState({ equityGrants: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    await seedPerson(db, 'Alice');
    // Trigger a load so the store has the person available for the radio picker.
    await usePersonsStore.getState().load();
  });

  afterEach(async () => {
    await db.close();
    vi.useRealTimers();
  });

  it('does not render dialog content when open=false', () => {
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={false} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/^add equity grant$/i)).toBeNull();
  });

  it('renders the form when open=true', async () => {
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={true} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/^add equity grant$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^company$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/grant date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current fmv/i)).toBeInTheDocument();
  });

  it('exposes the calculator section inside the dialog', async () => {
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={true} onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/estimate it from company valuation/i),
    ).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves a grant via useEquityGrantsStore.create and shows success feedback', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText(/^name$/i), '2024 RSU Grant');
    await user.type(screen.getByLabelText(/^company$/i), 'NewCo');
    await user.click(screen.getByRole('radio', { name: /^alice$/i }));
    await selectDate(user, 'grant-date', '2024-01-15');
    const sharesInput = screen.getByLabelText(/total shares/i);
    await user.clear(sharesInput);
    await user.type(sharesInput, '500');
    const fmvInput = screen.getByLabelText(/current fmv/i);
    await user.clear(fmvInput);
    await user.type(fmvInput, '20');
    await selectDate(user, 'vesting-row-0-date', '2026-01-15');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Success feedback appears.
    expect(await screen.findByText(/added 2024 RSU Grant/i)).toBeInTheDocument();

    // The grant was persisted via the store.
    const { equityGrants } = useEquityGrantsStore.getState();
    expect(equityGrants).toHaveLength(1);
    expect(equityGrants[0].name).toBe('2024 RSU Grant');
    expect(equityGrants[0].companyName).toBe('NewCo');
    expect(equityGrants[0].totalShares).toBe(500);

    // After the auto-close delay, onOpenChange(false) fires.
    vi.advanceTimersByTime(900);
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('Cancel does not call useEquityGrantsStore.create', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <AddEquityGrantDialog open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(useEquityGrantsStore.getState().equityGrants).toHaveLength(0);
  });
});
