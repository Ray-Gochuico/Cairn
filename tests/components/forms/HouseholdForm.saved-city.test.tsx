import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { saveStateCity } from '@/domain/setup-flow/steps/part1';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { FilingStatus } from '@/types/enums';
import HouseholdForm, {
  HOUSEHOLD_DEFAULT_VALUES,
  type HouseholdFormValues,
} from '@/components/forms/HouseholdForm';
import SetupHouseholdForm from '@/pages/setup/forms/HouseholdForm';
import Section1_WhoYouAre from '@/pages/setup/Section1_WhoYouAre';
import HouseholdTab from '@/pages/inputs/HouseholdTab';
import type { FlowCtx } from '@/domain/setup-flow/types';
import { makeHousehold } from '../../factories';

/**
 * v1.8.0 O3 (RC3, CR-O-4): a saved city holds. HouseholdForm used to clear a
 * saved non-CA city in a mount effect whose first-render closure still saw the
 * 'CA' default (RHF seeds _formValues from defaultValues), which also dirtied
 * the untouched form, so the next Save of anything wrote city = null. Every
 * seeded CITY rule is non-CA, so every saved city was exposed. The city now
 * clears only in the state field's own change path.
 */

// The real store actions, kept so the real-database block can restore them
// after the component block swaps in fakes (zustand setState merges).
const REAL_HOUSEHOLD = useHouseholdStore.getState();
const REAL_TAX_RULES = useTaxRulesStore.getState();

const NYC_RULE = {
  id: 1,
  year: 2026,
  jurisdictionType: 'CITY' as const,
  jurisdictionCode: 'NY_NYC',
  filingStatus: FilingStatus.SINGLE,
  brackets: [
    { min: 0, max: 12000, rate: 0.03078 },
    { min: 12000, max: 25000, rate: 0.03762 },
    { min: 25000, max: 50000, rate: 0.03819 },
    { min: 50000, max: null, rate: 0.03876 },
  ],
  standardDeduction: 0,
};

const SAVED_NY: HouseholdFormValues = {
  ...HOUSEHOLD_DEFAULT_VALUES,
  state: 'NY',
  city: 'NY_NYC',
  monthlyExpenseBaseline: 4000,
};

const citySelect = (root: HTMLElement | typeof screen = screen) =>
  (root.getByLabelText('City (only if it has local income tax)') as HTMLSelectElement);

function renderForm(values: HouseholdFormValues | undefined, onSubmit = vi.fn(async () => {})) {
  const ui = (
    <MemoryRouter>
      <HouseholdForm values={values} onSubmit={onSubmit} />
    </MemoryRouter>
  );
  return { ...render(ui), onSubmit };
}

describe('HouseholdForm — a saved city holds at open (v1.8.0 O3, RC3)', () => {
  beforeEach(() => {
    useTaxRulesStore.setState({
      year: 2026, items: [NYC_RULE], isLoading: false, error: null, loadYear: async () => {},
    } as never);
  });

  it('opens a saved New York household with New York City selected and Save not enabled', () => {
    renderForm(SAVED_NY);
    expect(screen.getByLabelText('State')).toHaveValue('NY');
    expect(citySelect().value).toBe('NY_NYC');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('holds the saved city and the clean form under StrictMode too (src/main.tsx)', () => {
    render(
      <StrictMode>
        <MemoryRouter>
          <HouseholdForm values={SAVED_NY} onSubmit={async () => {}} />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(citySelect().value).toBe('NY_NYC');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a Filing status pick, then Save, submits the saved city unchanged', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(SAVED_NY);
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Married Filing Jointly' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      filingStatus: FilingStatus.MFJ, state: 'NY', city: 'NY_NYC', monthlyExpenseBaseline: 4000,
    });
  });

  it('values that arrive after mount hold their city and stay clean (control)', async () => {
    const { rerender } = renderForm(undefined);
    rerender(
      <MemoryRouter>
        <HouseholdForm values={SAVED_NY} onSubmit={async () => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByLabelText('State')).toHaveValue('NY'));
    expect(citySelect().value).toBe('NY_NYC');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it("the user's own state edit to a state the city does not match clears the city (designed)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(SAVED_NY);
    await user.clear(screen.getByLabelText('State'));
    await user.type(screen.getByLabelText('State'), 'OH');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ state: 'OH', city: null });
  });

  it('unsaved entries survive a Filing status pick (control)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ ...HOUSEHOLD_DEFAULT_VALUES });
    await user.type(screen.getByLabelText('Household name (optional)'), 'Rivera');
    await user.clear(screen.getByLabelText('Monthly expense baseline ($)'));
    await user.type(screen.getByLabelText('Monthly expense baseline ($)'), '4200');
    await user.clear(screen.getByLabelText('State'));
    await user.type(screen.getByLabelText('State'), 'NY');
    await user.selectOptions(citySelect(), 'NY_NYC');
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Head of Household' }));
    expect(screen.getByLabelText('Household name (optional)')).toHaveValue('Rivera');
    expect(citySelect().value).toBe('NY_NYC');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Rivera', monthlyExpenseBaseline: 4200, state: 'NY', city: 'NY_NYC', filingStatus: FilingStatus.HOH,
    });
  });

  it('/setup Section 1 adapter: an entry typed while its mount load is in flight keeps the city when the load lands', async () => {
    const user = userEvent.setup();
    let land: () => void = () => {};
    const update = vi.fn(async (_patch: Partial<HouseholdFormValues>) => {});
    const saved = () => makeHousehold({ state: 'NY', city: 'NY_NYC', monthlyExpenseBaseline: 4000 });
    useHouseholdStore.setState({
      household: saved(), isLoading: false, error: null, update,
      load: () => {
        useHouseholdStore.setState({ isLoading: true });
        return new Promise<void>((resolve) => {
          land = () => { useHouseholdStore.setState({ household: saved(), isLoading: false }); resolve(); };
        });
      },
    } as never);
    render(<MemoryRouter><SetupHouseholdForm /></MemoryRouter>);
    await user.clear(screen.getByLabelText('Monthly expense baseline ($)'));
    await user.type(screen.getByLabelText('Monthly expense baseline ($)'), '4500');
    await act(async () => land());
    expect(screen.getByLabelText('Monthly expense baseline ($)')).toHaveValue(4500);
    expect(citySelect().value).toBe('NY_NYC');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ monthlyExpenseBaseline: 4500, state: 'NY', city: 'NY_NYC' });
  });

  it('a saved row whose city does not match its state opens as stored and stays clean (no clear at hydration)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ ...SAVED_NY, state: 'NJ' });
    expect(screen.getByLabelText('State')).toHaveValue('NJ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // A complete state never lists the held city: no option matches NJ (CX-O3-1).
    expect(citySelect().value).toBe('');
    expect(citySelect().selectedOptions[0]?.textContent).toBe('(No local tax)');
    // Only the user's own state edit clears a city; a Filing status pick keeps the stored one.
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Married Filing Jointly' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ state: 'NJ', city: 'NY_NYC', filingStatus: FilingStatus.MFJ });
  });
});

describe('Household surfaces over the real database — a saved city holds (v1.8.0 O3, RC3)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    localStorage.clear();
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({
      household: null, isLoading: false, error: null,
      load: REAL_HOUSEHOLD.load, update: REAL_HOUSEHOLD.update,
    });
    useTaxRulesStore.setState({
      year: null, items: [], isLoading: false, error: null, loadYear: REAL_TAX_RULES.loadYear,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  const savedRow = async () =>
    (await db.select<{ state: string; city: string | null; filing_status: string; monthly_expense_baseline: number }>(
      'SELECT state, city, filing_status, monthly_expense_baseline FROM household WHERE id = 1',
    ))[0];

  it('/setup Section 1: a city saved by worded 1c shows when the dialog opens and on reopen, Save is not enabled, and a Filing status change saves it unchanged', async () => {
    const user = userEvent.setup();
    await saveStateCity({ state: 'NY', city: 'NY_NYC' }, { progress: defaultProgressV2() } as FlowCtx);
    expect(await savedRow()).toMatchObject({ state: 'NY', city: 'NY_NYC' });
    render(
      <MemoryRouter>
        <Section1_WhoYouAre hasData settled status="in_progress" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByText(/Single · NY ·/);
    await user.click(screen.getAllByRole('button', { name: 'Add manually' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Household' });
    await waitFor(() => expect(useHouseholdStore.getState().isLoading).toBe(false));
    await waitFor(() => expect(citySelect(within(dialog)).value).toBe('NY_NYC'));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Married Filing Jointly' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Household' })).toBeNull());
    expect(await savedRow()).toMatchObject({ state: 'NY', city: 'NY_NYC', filing_status: 'MFJ' });
    // Reopened, the saved city and the clean form hold again.
    await user.click(screen.getAllByRole('button', { name: 'Add manually' })[0]);
    const reopened = await screen.findByRole('dialog', { name: 'Household' });
    await waitFor(() => expect(citySelect(within(reopened)).value).toBe('NY_NYC'));
    expect(within(reopened).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Inputs → Household: opened with the household already loaded, the tab shows the saved city, Save is not enabled, and an expense edit saves it unchanged', async () => {
    const user = userEvent.setup();
    await saveStateCity({ state: 'NY', city: 'NY_NYC' }, { progress: defaultProgressV2() } as FlowCtx);
    await useHouseholdStore.getState().load(); // e.g. arriving from /setup
    render(<MemoryRouter><HouseholdTab /></MemoryRouter>);
    await waitFor(() => expect(useHouseholdStore.getState().isLoading).toBe(false));
    await waitFor(() => expect(citySelect().value).toBe('NY_NYC'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Monthly expense baseline ($)'));
    await user.type(screen.getByLabelText('Monthly expense baseline ($)'), '4100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await savedRow()).toMatchObject({ monthly_expense_baseline: 4100 }));
    expect(await savedRow()).toMatchObject({ state: 'NY', city: 'NY_NYC' });
  });
});

describe('HouseholdForm — the city waits for a complete state (v1.8.0 O3, RC3, CR-O-4)', () => {
  beforeEach(() => {
    useTaxRulesStore.setState({
      year: 2026, items: [NYC_RULE], isLoading: false, error: null, loadYear: async () => {},
    } as never);
  });

  it('backspacing the state to one letter and retyping it keeps New York City and leaves the form clean', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(SAVED_NY);
    const stateInput = screen.getByLabelText('State');
    await user.click(stateInput);
    await user.keyboard('{End}{Backspace}');
    expect(stateInput).toHaveValue('N');
    await user.keyboard('Y');
    expect(stateInput).toHaveValue('NY');
    expect(citySelect().value).toBe('NY_NYC');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // A Filing status change then saves the city it kept.
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Married Filing Separately' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ state: 'NY', city: 'NY_NYC', filingStatus: FilingStatus.MFS });
  });

  it('while the state reads one letter, the select still shows the city the form holds', async () => {
    const user = userEvent.setup();
    renderForm(SAVED_NY);
    await user.click(screen.getByLabelText('State'));
    await user.keyboard('{End}{Backspace}');
    expect(screen.getByLabelText('State')).toHaveValue('N');
    expect(citySelect().value).toBe('NY_NYC');
    expect(citySelect().selectedOptions[0]?.textContent).toBe('NYC');
  });

  it('a picked complete state the city does not match clears it at once (designed)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(SAVED_NY);
    const stateInput = screen.getByLabelText('State');
    // A datalist pick replaces the whole value in one input event.
    fireEvent.change(stateInput, { target: { value: 'NJ' } });
    expect(stateInput).toHaveValue('NJ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ state: 'NJ', city: null });
  });
});
