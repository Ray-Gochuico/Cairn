import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonsRepo } from '@/domain/persons';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import EquityGrantsTab from '@/pages/inputs/EquityGrantsTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');
const loadEquityGrantCompanyValuationMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0027_equity_grant_company_valuation.sql'), 'utf-8');

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

const sampleSchedule = [
  { date: '2024-01-15', cumulativePct: 0.25 },
  { date: '2025-01-15', cumulativePct: 0.50 },
  { date: '2026-01-15', cumulativePct: 0.75 },
  { date: '2027-01-15', cumulativePct: 1.0 },
];

async function seedGrant(
  db: SqliteAdapter,
  ownerPersonId: number,
  overrides: Partial<{
    name: string;
    companyName: string;
    grantDate: string;
    strikePrice: number;
    totalShares: number;
    currentFmv: number;
  }> = {},
): Promise<number> {
  const repo = new EquityGrantsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId,
    name: overrides.name ?? 'New Hire RSU Grant',
    companyName: overrides.companyName ?? 'Acme Corp',
    grantDate: overrides.grantDate ?? '2023-01-15',
    strikePrice: overrides.strikePrice ?? 0,
    totalShares: overrides.totalShares ?? 1200,
    vestingSchedule: sampleSchedule,
    currentFmv: overrides.currentFmv ?? 145.50,
  });
}

describe('EquityGrantsTab', () => {
  let db: SqliteAdapter;
  let alexId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0027_equity_grant_company_valuation', sql: loadEquityGrantCompanyValuationMigration() },
    ]);
    setDatabase(db);
    useEquityGrantsStore.setState({ equityGrants: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    alexId = await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no grants exist', async () => {
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no equity grants added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add a grant/i })).toBeInTheDocument();
  });

  it('opens the add-grant form when clicking Add a grant', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a grant/i }));
    await user.click(screen.getByRole('button', { name: /add a grant/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^company$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/grant date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/strike price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/total shares/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current fmv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/vesting template/i)).toBeInTheDocument();
  });

  it('creates a grant via the form (with template-applied schedule)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a grant/i }));
    await user.click(screen.getByRole('button', { name: /add a grant/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '2024 RSU grant' } });
    fireEvent.change(screen.getByLabelText(/^company$/i), { target: { value: 'Acme Corp' } });
    await user.click(screen.getByRole('radio', { name: /^alex$/i }));
    await selectDate(user, 'grant-date', '2024-01-15');
    fireEvent.change(screen.getByLabelText(/strike price/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/total shares/i), { target: { value: '4800' } });
    fireEvent.change(screen.getByLabelText(/current fmv/i), { target: { value: '120' } });

    // Apply the 4-year monthly with 1-year cliff template
    await user.selectOptions(
      screen.getByLabelText(/vesting template/i),
      'FOUR_YR_MONTHLY_ONE_YR_CLIFF',
    );

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { equityGrants } = useEquityGrantsStore.getState();
      expect(equityGrants).toHaveLength(1);
      expect(equityGrants[0].name).toBe('2024 RSU grant');
      expect(equityGrants[0].companyName).toBe('Acme Corp');
      expect(equityGrants[0].ownerPersonId).toBe(alexId);
      expect(equityGrants[0].grantDate).toBe('2024-01-15');
      expect(equityGrants[0].totalShares).toBe(4800);
      expect(equityGrants[0].currentFmv).toBe(120);
      // 4-year monthly with 1-year cliff: cliff entry at month 12 + 36 monthly
      // entries (months 13..48) = 37 vesting rows total.
      expect(equityGrants[0].vestingSchedule).toHaveLength(37);
      expect(equityGrants[0].vestingSchedule[36].cumulativePct).toBeCloseTo(1.0, 9);
    });

    expect(await screen.findByText('2024 RSU grant')).toBeInTheDocument();
  }, 15000);
  // ↑ 15s timeout (vs vitest's 5s default) because this test makes 9 sequential
  // user-event calls before the failing waitFor. Under full-suite parallelism
  // each user-event microtask costs ~500ms, blowing the default budget. See
  // docs/reviews/2026-05-27-testing-wave3.md § N1.

  it('opens the edit form prefilled when clicking Edit', async () => {
    const user = userEvent.setup();
    await seedGrant(db, alexId, { name: 'Existing Grant', companyName: 'Globex' });

    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('Existing Grant'));

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const nameInput = await screen.findByLabelText(/^name$/i);
    expect((nameInput as HTMLInputElement).value).toBe('Existing Grant');
    expect((screen.getByLabelText(/^company$/i) as HTMLInputElement).value).toBe('Globex');

    fireEvent.change(nameInput, { target: { value: 'Updated Grant' } });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { equityGrants } = useEquityGrantsStore.getState();
      expect(equityGrants[0].name).toBe('Updated Grant');
    });
  });

  it('pre-fills the calculator section when editing a grant with saved valuation inputs', async () => {
    const user = userEvent.setup();
    const repo = new EquityGrantsRepo(db);
    await repo.create({
      householdId: 1,
      ownerPersonId: alexId,
      name: 'With Calculator',
      companyName: 'PrivateCo',
      grantDate: '2024-01-15',
      strikePrice: 0,
      totalShares: 500,
      vestingSchedule: sampleSchedule,
      currentFmv: 10,
      companyValuation: 10_000_000,
      companyOutstandingShares: 5_000_000,
      companyTotalDebt: 2_000_000,
    });

    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('With Calculator'));
    await user.click(screen.getByRole('button', { name: /edit/i }));

    // The <details> section should be open because all three values are non-null.
    const summary = await screen.findByText(/estimate it from company valuation/i);
    const details = summary.closest('details');
    expect(details?.open).toBe(true);

    // Inputs reflect the persisted values.
    expect(
      (screen.getByLabelText(/company valuation/i) as HTMLInputElement).value,
    ).toBe('10000000');
    expect(
      (screen.getByLabelText(/outstanding shares/i) as HTMLInputElement).value,
    ).toBe('5000000');
    expect(
      (screen.getByLabelText(/total debt/i) as HTMLInputElement).value,
    ).toBe('2000000');
  });

  it('round-trips updated calculator fields through the edit form', async () => {
    const user = userEvent.setup();
    const repo = new EquityGrantsRepo(db);
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: alexId,
      name: 'Round Trip',
      companyName: 'PrivateCo',
      grantDate: '2024-01-15',
      strikePrice: 0,
      totalShares: 500,
      vestingSchedule: sampleSchedule,
      currentFmv: 10,
      companyValuation: null,
      companyOutstandingShares: null,
      companyTotalDebt: null,
    });

    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('Round Trip'));
    await user.click(screen.getByRole('button', { name: /edit/i }));

    // Open calculator (it starts closed since the fields were null).
    await user.click(screen.getByText(/estimate it from company valuation/i));
    await user.type(screen.getByLabelText(/company valuation/i), '20000000');
    await user.type(screen.getByLabelText(/total debt/i), '5000000');
    await user.type(screen.getByLabelText(/outstanding shares/i), '4000000');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(async () => {
      const out = await repo.findById(id);
      expect(out?.companyValuation).toBe(20_000_000);
      expect(out?.companyTotalDebt).toBe(5_000_000);
      expect(out?.companyOutstandingShares).toBe(4_000_000);
    });
  });

  it('editing a single vesting row updates cumulativePct', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a grant/i }));
    await user.click(screen.getByRole('button', { name: /add a grant/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Custom Grant' } });
    fireEvent.change(screen.getByLabelText(/^company$/i), { target: { value: 'Initech' } });
    await user.click(screen.getByRole('radio', { name: /^alex$/i }));
    await selectDate(user, 'grant-date', '2024-01-15');
    fireEvent.change(screen.getByLabelText(/total shares/i), { target: { value: '1000' } });

    // Default schedule starts as a single row with cumulativePct = 1.0
    // Find row 1's percent input and edit it (still 1.0 since we need a complete schedule)
    const pctInput = screen.getByLabelText(/cumulative % for row 1/i) as HTMLInputElement;
    expect(pctInput.value).toBe('1');
    fireEvent.change(pctInput, { target: { value: '1' } });
    expect(pctInput.value).toBe('1');

    // Now also set a date for that single row so the schedule is valid
    await selectDate(user, 'vesting-row-0-date', '2025-01-15');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { equityGrants } = useEquityGrantsStore.getState();
      expect(equityGrants).toHaveLength(1);
      expect(equityGrants[0].vestingSchedule).toHaveLength(1);
      expect(equityGrants[0].vestingSchedule[0].cumulativePct).toBeCloseTo(1.0, 9);
      expect(equityGrants[0].vestingSchedule[0].date).toBe('2025-01-15');
    });
  });

  it('switching template fills the schedule from grant date', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a grant/i }));
    await user.click(screen.getByRole('button', { name: /add a grant/i }));

    // Set grant date so the template can compute vesting dates from it.
    await selectDate(user, 'grant-date', '2024-01-15');

    // Apply the 3-year monthly w/ 6-mo cliff template (1 cliff + 30 monthly = 31 rows)
    await user.selectOptions(
      screen.getByLabelText(/vesting template/i),
      'THREE_YR_MONTHLY_SIX_MO_CLIFF',
    );

    // The Remove button appears for each schedule row; we expect 31 of them.
    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
      expect(removeButtons).toHaveLength(31);
    });
  });

  it('shows error when ownerPersonId is missing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a grant/i }));
    await user.click(screen.getByRole('button', { name: /add a grant/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'No Owner Grant' } });
    fireEvent.change(screen.getByLabelText(/^company$/i), { target: { value: 'NoOwnerCo' } });
    // Intentionally do NOT select an owner radio
    await selectDate(user, 'grant-date', '2024-01-15');
    fireEvent.change(screen.getByLabelText(/total shares/i), { target: { value: '100' } });

    // Apply a template so the schedule itself is valid
    await user.selectOptions(
      screen.getByLabelText(/vesting template/i),
      'FOUR_YR_MONTHLY_ONE_YR_CLIFF',
    );

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // The grant must NOT have been created — schema rejects ownerPersonId of 0.
    await waitFor(() => {
      const { equityGrants } = useEquityGrantsStore.getState();
      expect(equityGrants).toHaveLength(0);
      // Some error surface should be shown from RHF/zod validation.
      expect(screen.getByText(/ownerPersonId/i)).toBeInTheDocument();
    });
  });

  it('lists multiple grants with company and shares', async () => {
    await seedGrant(db, alexId, { name: 'RSU 2023', companyName: 'Acme', totalShares: 500 });
    await seedGrant(db, alexId, { name: 'RSU 2024', companyName: 'Globex', totalShares: 800 });

    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('RSU 2023'));
    expect(screen.getByText('RSU 2024')).toBeInTheDocument();
    expect(screen.getAllByText(/Acme/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Globex/i).length).toBeGreaterThan(0);
  });

  it('renders an Import CSV button in the page header', async () => {
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', async () => {
    render(<MemoryRouter><EquityGrantsTab /></MemoryRouter>);
    expect(
      await screen.findByTestId('import-csv-file-input'),
    ).toBeInTheDocument();
  });
});
