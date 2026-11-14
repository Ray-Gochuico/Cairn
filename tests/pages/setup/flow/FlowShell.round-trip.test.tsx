import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The step registry pulls the Section-4 importer → PDF pipeline; mock before
// imports, verbatim from FlowShell.db.test.tsx.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({ issuer: 'GENERIC', transactions: [] }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FlowShell from '@/pages/setup/flow/FlowShell';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import {
  defaultProgressV2, loadSetupProgress, saveSetupProgress,
  SETUP_PROGRESS_V2_KEY, SetupProgressV2Schema,
  type SetupProgressV2, type StepId,
} from '@/lib/setup-progress';
import { HouseholdRepo } from '@/domain/household';
import { PersonsRepo } from '@/domain/persons';
import { DependentsRepo } from '@/domain/dependents';
import { AccountsRepo } from '@/domain/accounts';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import { LoansRepo } from '@/domain/loans';
import { useHouseholdStore } from '@/stores/household-store';
import { SETUP_DISMISSED_KEY, finishSetup } from '@/lib/setup-dismissal';
import {
  makeAccount, makeDependent, makeLoan, makePerson, makeProperty, makeVehicle,
} from '../../../factories';

/**
 * v1.8.0 O3 (CR-O-5): re-entering a worded step and pressing Next without
 * touching it never changes saved data. The shell runs every step's save on
 * Next whether or not the step is dirty (FlowShell.tsx handleNext), so a
 * prefill that cannot represent a saved answer overwrites it silently. One
 * round trip per step through the REAL shell, stores and in-memory DB (the
 * FlowShell.db pattern): enter a representative answer → Next → Back (the
 * re-entry: asked, prefilled) → Next untouched → every saved row and the
 * progress record (cursor aside) are unchanged.
 */

const TABLES = [
  'household', 'persons', 'dependents', 'accounts', 'account_snapshots', 'properties',
  'housing_payments', 'vehicles', 'vehicle_leases', 'equity_grants', 'loans',
  'transactions', 'goals',
] as const;

type User = ReturnType<typeof userEvent.setup>;
type Statuses = SetupProgressV2['statuses'];

let db: SqliteAdapter;

/** Every saved row (minus the clock columns a same-value UPDATE re-stamps)
 *  plus the progress record minus its cursor. */
async function savedData() {
  await act(async () => {}); // the shell persists progress in an effect
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const r = await db.select<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY id`);
    rows[t] = r.map(({ updated_at: _u, created_at: _c, ...rest }) => rest);
  }
  // A stored record the schema rejects loads as a fresh default, so check it
  // parses (else a rejected shape would compare two defaults).
  const raw = localStorage.getItem(SETUP_PROGRESS_V2_KEY);
  expect(raw != null && SetupProgressV2Schema.safeParse(JSON.parse(raw)).success, 'the stored progress record parses').toBe(true);
  const { cursor: _cursor, ...progress } = loadSetupProgress();
  return { rows, progress };
}

function startAt(stepId: StepId, progress: Partial<SetupProgressV2>, role?: 'you' | 'partner') {
  saveSetupProgress({ ...defaultProgressV2(), ...progress, cursor: { stepId, role } });
  render(
    <MemoryRouter>
      <FlowShell onSwitchView={vi.fn()} />
    </MemoryRouter>,
  );
}

/** answer → Next → Back (→ the re-entry check) → untouched Next → saved
 *  data unchanged. */
async function roundTrip(
  user: User, at: RegExp, next: RegExp, answer: () => Promise<void>,
  reentry?: () => void | Promise<void>,
) {
  await screen.findByRole('heading', { name: at });
  await answer();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: next });
  const saved = await savedData();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: at });
  await reentry?.();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: next });
  expect(await savedData()).toEqual(saved);
  return saved;
}

async function pickDate(user: User, label: string, y: string, m: string, d: string) {
  await user.selectOptions(screen.getByLabelText(`${label} year`), y);
  await user.selectOptions(screen.getByLabelText(`${label} month`), m);
  await user.selectOptions(screen.getByLabelText(`${label} day`), d);
}

const withoutId = <T extends { id?: number }>({ id: _id, ...rest }: T) => rest;
type Rows = Awaited<ReturnType<typeof savedData>>['rows'];

/** 1b re-entered: Yes → "It's more complicated" → the picked status, as picked (CL-O3-1). */
function expectComplicatedReRead(option: string) {
  expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
  expect(screen.getByRole('radio', { name: "It's more complicated / I'm not sure" })).toBeChecked();
  expect(screen.getByRole('combobox', { name: /filing status/i })).toHaveTextContent(option);
}
const filingOf = (saved: Awaited<ReturnType<typeof savedData>>) => saved.rows.household[0].filing_status;

const YOU = { name: 'Alex Rivera', dateOfBirth: '1990-05-01' };
const JORDAN = { name: 'Jordan Lee', dateOfBirth: '1991-08-21' };
const PART1_DONE: Statuses = {
  about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
  dependents_gate: 'skipped', expenses: 'completed',
};
const PART2_DONE: Statuses = {
  ...PART1_DONE, 'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
};

beforeEach(async () => {
  localStorage.clear();
  db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  setDatabase(db);
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
});

afterEach(async () => {
  await db.close();
});

describe('worded flow round trip — Part 1 (v1.8.0 O3, CR-O-5)', () => {
  it('1a about you: a drafted name and date of birth', async () => {
    const user = userEvent.setup();
    startAt('about_you', {});
    const saved = await roundTrip(user, /^About you — step 1 of/, /^About you — step 2 of/, async () => {
      await user.type(screen.getByLabelText('Your name'), YOU.name);
      await pickDate(user, 'Your date of birth', '1990', '05', '01');
    });
    expect(saved.progress.drafts.you).toEqual(YOU);
  });

  it('1a about you: an existing person, renamed', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('about_you', { bindings: { you } });
    const saved = await roundTrip(user, /^About you — step 1 of/, /^About you — step 2 of/, async () => {
      await user.clear(screen.getByLabelText('Your name'));
      await user.type(screen.getByLabelText('Your name'), 'Alex R. Rivera');
    });
    expect(saved.rows.persons[0]).toMatchObject({ name: 'Alex R. Rivera' });
  });

  for (const [radio, fs] of [['Jointly', 'MFJ'], ['Separately', 'MFS']] as const) {
    it(`1b marital: Yes → ${radio}, with a partner name and date of birth`, async () => {
      const user = userEvent.setup();
      startAt('marital_filing', { statuses: { about_you: 'completed' }, drafts: { you: YOU } });
      const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
        await user.click(screen.getByRole('radio', { name: 'Yes' }));
        await user.click(screen.getByRole('radio', { name: radio }));
        await user.type(screen.getByLabelText("Your partner's name"), JORDAN.name);
        await pickDate(user, "Your partner's date of birth", '1991', '08', '21');
      });
      expect(filingOf(saved)).toBe(fs);
      expect(saved.progress.drafts.partner).toEqual(JORDAN);
    });
  }

  it('1b marital: Yes → Jointly, with a partner name only', async () => {
    const user = userEvent.setup();
    startAt('marital_filing', { statuses: { about_you: 'completed' }, drafts: { you: YOU } });
    const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('radio', { name: 'Jointly' }));
      await user.type(screen.getByLabelText("Your partner's name"), JORDAN.name);
    });
    expect(saved.progress.drafts.partner).toEqual({ name: JORDAN.name, dateOfBirth: '' });
  });

  const complicated = [
    ['Married Filing Jointly', 'MFJ'], ['Married Filing Separately', 'MFS'],
    ['Head of Household', 'HOH'], ['Single', 'SINGLE'],
  ] as const;
  for (const [option, fs] of complicated) {
    it(`1b marital: Yes → It's more complicated → ${option}, with a partner`, async () => {
      const user = userEvent.setup();
      startAt('marital_filing', { statuses: { about_you: 'completed' }, drafts: { you: YOU } });
      const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
        await user.click(screen.getByRole('radio', { name: 'Yes' }));
        await user.click(screen.getByRole('radio', { name: "It's more complicated / I'm not sure" }));
        await user.type(screen.getByLabelText("Your partner's name"), JORDAN.name);
        await pickDate(user, "Your partner's date of birth", '1991', '08', '21');
        // The dropdown pick comes after the typed entries (Ray's report order).
        await user.click(screen.getByRole('combobox', { name: /filing status/i }));
        await user.click(await screen.findByRole('option', { name: option }));
      }, () => {
        expectComplicatedReRead(option);
        expect(screen.getByLabelText("Your partner's name")).toHaveValue(JORDAN.name);
      });
      expect(filingOf(saved)).toBe(fs);
      expect(saved.progress.drafts.partner).toEqual(JORDAN);
    });
  }

  for (const [option, fs] of [['Head of Household', 'HOH'], ['Single', 'SINGLE']] as const) {
    it(`1b marital: Yes → It's more complicated → ${option}, with no partner entered`, async () => {
      const user = userEvent.setup();
      startAt('marital_filing', { statuses: { about_you: 'completed' }, drafts: { you: YOU } });
      const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
        await user.click(screen.getByRole('radio', { name: 'Yes' }));
        await user.click(screen.getByRole('radio', { name: "It's more complicated / I'm not sure" }));
        await user.click(screen.getByRole('combobox', { name: /filing status/i }));
        await user.click(await screen.findByRole('option', { name: option }));
      }, () => {
        expectComplicatedReRead(option); // CL-O3-1: re-read as picked, not as No
        expect(screen.getByLabelText("Your partner's name")).toHaveValue('');
      });
      expect(filingOf(saved)).toBe(fs);
      expect(saved.progress.drafts.partner).toBeUndefined();
      expect(saved.progress.drafts.marital).toEqual({ married: 'yes', filing: 'complicated', complicatedStatus: fs });
    });
  }

  const unmarried = [
    ['Single', 'SINGLE'],
    ['I pay more than half the cost of a home for a qualifying dependent', 'HOH'],
  ] as const;
  for (const [radio, fs] of unmarried) {
    it(`1b marital: No → ${fs}`, async () => {
      const user = userEvent.setup();
      startAt('marital_filing', { statuses: { about_you: 'completed' }, drafts: { you: YOU } });
      const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
        await user.click(screen.getByRole('radio', { name: 'No' }));
        await user.click(screen.getByRole('radio', { name: radio }));
      });
      expect(filingOf(saved)).toBe(fs);
      expect(saved.progress.drafts.marital).toEqual({ married: 'no', filing: null, complicatedStatus: null });
    });
  }

  it('1c state and city: New York with New York City', async () => {
    const user = userEvent.setup();
    startAt('state_city', { statuses: { about_you: 'completed', marital_filing: 'completed' }, drafts: { you: YOU } });
    const saved = await roundTrip(user, /^About you — step 3 of/, /^About you — step 4 of/, async () => {
      await user.type(screen.getByLabelText('Which state do you live in?'), 'NY');
      await user.selectOptions(await screen.findByLabelText('City income tax'), 'NY_NYC');
    });
    expect(saved.rows.household[0]).toMatchObject({ state: 'NY', city: 'NY_NYC' });
  });

  it('1e expenses: a monthly figure', async () => {
    const user = userEvent.setup();
    startAt('expenses', {
      statuses: { about_you: 'completed', marital_filing: 'completed', state_city: 'completed', dependents_gate: 'skipped' },
      drafts: { you: YOU },
    });
    const saved = await roundTrip(user, /^About you — step 5 of/, /^Work & pay — step 1 of/, async () => {
      await user.type(screen.getByLabelText('About how much does your household spend in a month?'), '4250');
    });
    expect(saved.rows.household[0]).toMatchObject({ monthly_expense_baseline: 4250 });
  });

  it('1e expenses: $0 a month, over a saved figure', async () => {
    const user = userEvent.setup();
    await new HouseholdRepo(db).update({ monthlyExpenseBaseline: 4250 }); // e.g. entered in the form view
    startAt('expenses', {
      statuses: { about_you: 'completed', marital_filing: 'completed', state_city: 'completed', dependents_gate: 'skipped' },
      drafts: { you: YOU },
    });
    const saved = await roundTrip(user, /^About you — step 5 of/, /^Work & pay — step 1 of/, async () => {
      await user.type(screen.getByLabelText('About how much does your household spend in a month?'), '0');
    }, () => {
      // The answer re-reads as given: a saved 0 alone reads as never answered.
      expect(screen.getByLabelText('About how much does your household spend in a month?')).toHaveValue('0');
    });
    expect(saved.rows.household[0]).toMatchObject({ monthly_expense_baseline: 0 });
    expect(saved.progress.drafts.expenses).toEqual({ zero: true });
  });
});

describe('worded flow round trip — Part 2 (v1.8.0 O3, CR-O-5)', () => {
  const pays = [
    ['Salary', async (user: User) => {
      await user.type(screen.getByLabelText('Annual salary (pre-tax)'), '95000');
    }],
    ['Hourly', async (user: User) => {
      await user.type(screen.getByLabelText('Hourly rate'), '32.5');
      await user.clear(screen.getByLabelText('Regular hours / week'));
      await user.type(screen.getByLabelText('Regular hours / week'), '36');
    }],
    ['Salary with overtime', async (user: User) => {
      await user.type(screen.getByLabelText('Annual salary (pre-tax)'), '70000');
      await user.type(screen.getByLabelText('Hourly rate'), '40');
      await user.type(screen.getByLabelText(/OT threshold/), '40');
    }],
  ] as const;
  for (const [radio, fill] of pays) {
    it(`2a pay:you, before the person exists (a pay draft): ${radio}`, async () => {
      const user = userEvent.setup();
      startAt('pay', { statuses: PART1_DONE, drafts: { you: YOU } }, 'you');
      const saved = await roundTrip(user, /^Work & pay — step 1 of/, /^Work & pay — step 2 of/, async () => {
        await user.click(screen.getByRole('radio', { name: radio, exact: true }));
        await fill(user);
      });
      expect(saved.progress.drafts.pay?.you).toBeDefined();
    });
  }

  it('2a pay:you, an existing person: a new salary', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({ ...YOU, annualSalaryPretax: 95000 })));
    startAt('pay', { statuses: PART1_DONE, bindings: { you } }, 'you');
    let before: Rows | undefined;
    const saved = await roundTrip(user, /^Work & pay — step 1 of/, /^Work & pay — step 2 of/, async () => {
      before = (await savedData()).rows;
      await user.clear(screen.getByLabelText('Annual salary (pre-tax)'));
      await user.type(screen.getByLabelText('Annual salary (pre-tax)'), '101000');
    });
    // The edit changes exactly the edited field (CL-O3-2: the untouched Next writes nothing).
    expect(saved.rows.persons[0]).toEqual({ ...before!.persons[0], annual_salary_pretax: 101000 });
  });

  it('2b retirement:you: the one-shot create, then the update on re-entry', async () => {
    const user = userEvent.setup();
    startAt('retirement', {
      statuses: { ...PART1_DONE, 'pay:you': 'completed' },
      drafts: {
        you: YOU,
        pay: { you: { employmentType: 'SALARY_NO_OT', annualSalaryPretax: 95000, hourlyRate: null, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null } },
      },
    }, 'you');
    const saved = await roundTrip(user, /^Work & pay — step 2 of/, /^Work & pay — step 3 of/, async () => {
      await user.type(screen.getByLabelText('Target retirement age'), '62');
    });
    expect(saved.rows.persons).toHaveLength(1);
    expect(saved.rows.persons[0]).toMatchObject({ name: YOU.name, annual_salary_pretax: 95000, target_retirement_age: 62 });
  });

  it('2c benefits:you: a 401(k) percent, an HSA and a premium', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('benefits', { statuses: { ...PART1_DONE, 'pay:you': 'completed', 'retirement:you': 'completed' }, bindings: { you } }, 'you');
    const saved = await roundTrip(user, /^Work & pay — step 3 of/, /^What you own — step 1 of/, async () => {
      await user.type(screen.getByLabelText(/401\(k\)/), '6.5');
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('checkbox'));
      await user.type(screen.getByLabelText('HSA contribution / month'), '150');
      await user.type(screen.getByLabelText(/health insurance/), '210');
    });
    expect(saved.rows.persons[0]).toMatchObject({
      pretax_401k_pct: 0.065, hsa_eligible: 1, hsa_monthly_contribution: 150, health_insurance_monthly_premium: 210,
    });
  });

  it('2c benefits:you: a 0 % 401(k), HSA No and a $0 premium, over saved figures', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({ ...YOU, pretax401kPct: 0.05, healthInsuranceMonthlyPremium: 200 })));
    startAt('benefits', { statuses: { ...PART1_DONE, 'pay:you': 'completed', 'retirement:you': 'completed' }, bindings: { you } }, 'you');
    const saved = await roundTrip(user, /^Work & pay — step 3 of/, /^What you own — step 1 of/, async () => {
      await user.clear(screen.getByLabelText(/401\(k\)/));
      await user.type(screen.getByLabelText(/401\(k\)/), '0');
      await user.click(screen.getByRole('radio', { name: 'No' }));
      await user.clear(screen.getByLabelText(/health insurance/));
      await user.type(screen.getByLabelText(/health insurance/), '0');
    }, () => {
      // The answer re-reads as given: a saved 0 alone reads as never answered.
      expect(screen.getByLabelText(/401\(k\)/)).toHaveValue(0);
      expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
      expect(screen.getByLabelText(/health insurance/)).toHaveValue('0');
    });
    expect(saved.rows.persons[0]).toMatchObject({
      pretax_401k_pct: 0, hsa_eligible: 0, hsa_monthly_contribution: 0, health_insurance_monthly_premium: 0,
    });
    expect(saved.progress.drafts.benefits).toEqual({ you: { personId: you, hsa: 'no', zeros: ['pct401k', 'premiumMonthly'] } });
  });

  it('2c benefits:you: HSA No over a saved contribution (the honest zero)', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({ ...YOU, hsaEligible: true, hsaMonthlyContribution: 150 })));
    startAt('benefits', { statuses: { ...PART1_DONE, 'pay:you': 'completed', 'retirement:you': 'completed' }, bindings: { you } }, 'you');
    const saved = await roundTrip(user, /^Work & pay — step 3 of/, /^What you own — step 1 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'No' }));
    }, () => {
      expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    });
    expect(saved.rows.persons[0]).toMatchObject({ hsa_eligible: 1, hsa_monthly_contribution: 0 });
  });

  it('2c benefits:you: HSA Yes on an HSA-qualified plan, with no amount', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('benefits', { statuses: { ...PART1_DONE, 'pay:you': 'completed', 'retirement:you': 'completed' }, bindings: { you } }, 'you');
    const saved = await roundTrip(user, /^Work & pay — step 3 of/, /^What you own — step 1 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('checkbox'));
    }, () => {
      expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
      expect(screen.getByRole('checkbox')).toBeChecked();
      expect(screen.getByLabelText('HSA contribution / month')).toHaveValue('');
    });
    expect(saved.rows.persons[0]).toMatchObject({ hsa_eligible: 1, hsa_monthly_contribution: 0 });
  });

  it('2a pay:partner, before the partner exists (a pay draft): Salary', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('pay', { statuses: PART2_DONE, bindings: { you }, drafts: { partner: JORDAN } }, 'partner');
    const saved = await roundTrip(user, /^Work & pay — step 4 of/, /^Work & pay — step 5 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'Salary', exact: true }));
      await user.type(screen.getByLabelText('Annual salary (pre-tax)'), '88000');
    });
    expect(saved.progress.drafts.pay?.partner).toMatchObject({ annualSalaryPretax: 88000 });
  });

  it('2b retirement:partner: the one-shot partner create from the 1b draft, then the update on re-entry', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('retirement', { statuses: { ...PART2_DONE, 'pay:partner': 'completed' }, bindings: { you }, drafts: { partner: JORDAN } }, 'partner');
    const saved = await roundTrip(user, /^Work & pay — step 5 of/, /^Work & pay — step 6 of/, async () => {
      await user.type(screen.getByLabelText('Target retirement age'), '64');
    });
    expect(saved.rows.persons).toHaveLength(2);
    expect(saved.rows.persons[1]).toMatchObject({ name: JORDAN.name, date_of_birth: JORDAN.dateOfBirth, target_retirement_age: 64 });
    expect(saved.progress.drafts.partner).toBeUndefined();
  });
});

describe('worded flow round trip — the gates (v1.8.0 O3, CR-O-5)', () => {
  const OWN_DONE: Statuses = { ...PART2_DONE, accounts_gate: 'skipped', home_gate: 'completed' };
  const gates: Array<{
    id: StepId; at: RegExp; next: RegExp; statuses: Statuses;
    seed: ((d: SqliteAdapter) => Promise<number>) | null;
  }> = [
    {
      id: 'dependents_gate', at: /^About you — step 4 of/, next: /^About you — step 5 of/,
      statuses: { about_you: 'completed', marital_filing: 'completed', state_city: 'completed' },
      seed: (d) => new DependentsRepo(d).create(withoutId(makeDependent())),
    },
    {
      id: 'accounts_gate', at: /^What you own — step 1 of/, next: /^What you own — step 2 of/,
      statuses: PART2_DONE, seed: (d) => new AccountsRepo(d).create(withoutId(makeAccount()) as never),
    },
    {
      id: 'home_gate', at: /^What you own — step 2 of/, next: /^What you own — step 3 of/,
      statuses: { ...PART2_DONE, accounts_gate: 'skipped' },
      seed: (d) => new PropertiesRepo(d).create(withoutId(makeProperty())),
    },
    {
      id: 'vehicles_gate', at: /^What you own — step 3 of/, next: /^What you own — step 4 of/,
      statuses: OWN_DONE, seed: (d) => new VehiclesRepo(d).create(withoutId(makeVehicle())),
    },
    {
      id: 'equity_gate', at: /^What you own — step 4 of/, next: /^What you owe — step 1 of/,
      statuses: { ...OWN_DONE, vehicles_gate: 'skipped' }, seed: null,
    },
    {
      id: 'loans_gate', at: /^What you owe — step 1 of/, next: /^History & goals — step 1 of/,
      statuses: { ...OWN_DONE, vehicles_gate: 'skipped', equity_gate: 'skipped' },
      seed: (d) => new LoansRepo(d).create(withoutId(makeLoan())),
    },
    {
      id: 'import_gate', at: /^History & goals — step 1 of/, next: /^History & goals — step 2 of/,
      statuses: { ...OWN_DONE, vehicles_gate: 'skipped', equity_gate: 'skipped', loans_gate: 'skipped' },
      seed: null,
    },
  ];
  for (const g of gates) {
    for (const answer of ['No', 'Yes'] as const) {
      const rowNote = answer === 'No' ? '' : g.seed ? ', with one row' : ', with no rows yet';
      it(`${g.id}: ${answer}${rowNote}`, async () => {
        const user = userEvent.setup();
        const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
        if (g.statuses.home_gate === 'completed') {
          // a completed home gate needs its property (gate honesty)
          await new PropertiesRepo(db).create(withoutId(makeProperty({ name: 'Home' })));
        }
        if (answer === 'Yes' && g.seed) await g.seed(db);
        startAt(g.id, { statuses: g.statuses, bindings: { you } });
        const saved = await roundTrip(user, g.at, g.next, async () => {
          // With a row the control already reads Yes (the data decides).
          if (!(answer === 'Yes' && g.seed)) await user.click(screen.getByRole('radio', { name: answer }));
        });
        expect(saved.progress.gateAnswers[g.id]).toBe(answer === 'No' ? 'no' : 'yes');
      });
    }
  }

  it('rent_gate, shown after a home "No": No', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('rent_gate', { statuses: { ...PART2_DONE, accounts_gate: 'skipped', home_gate: 'skipped' }, bindings: { you } });
    const saved = await roundTrip(user, /^What you own — step 3 of/, /^What you own — step 4 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'No' }));
    });
    expect(saved.progress.gateAnswers.rent_gate).toBe('no');
  });

  it('goals_gate: No, re-entered through the History & goals part chip', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('goals_gate', {
      statuses: {
        ...PART2_DONE, accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
        vehicles_gate: 'skipped', equity_gate: 'skipped', loans_gate: 'skipped', import_gate: 'skipped',
      },
      gateAnswers: { import_gate: 'no' },
      bindings: { you },
    });
    await screen.findByRole('heading', { name: /^History & goals — step 2 of/ });
    await user.click(screen.getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: "That's everything." });
    const saved = await savedData();
    // Finish has no Back: the part chip re-enters at the import gate.
    await user.click(screen.getByRole('button', { name: /History & goals/ }));
    await screen.findByRole('heading', { name: /^History & goals — step 1 of/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: /^History & goals — step 2 of/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: "That's everything." });
    expect(await savedData()).toEqual(saved);
    expect(saved.progress.gateAnswers.goals_gate).toBe('no');
  });
});

describe('worded flow round trip — the paths plan review added (v1.8.0 O3, CR-O-5)', () => {
  it('1b marital: Yes → Jointly with person 2 already saved (the CW-19 bind)', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    const partner = await new PersonsRepo(db).create(withoutId(makePerson(JORDAN)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('marital_filing', { statuses: { about_you: 'completed' }, bindings: { you } });
    const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('radio', { name: 'Jointly' }));
    });
    expect(filingOf(saved)).toBe('MFJ');
    expect(saved.progress.bindings.partner).toBe(partner);
    expect(saved.progress.drafts.partner).toBeUndefined();
  });

  it('1b marital, Revisit setup (after finish, step not yet asked): an untouched Next keeps Married Filing Jointly and both people', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SETUP_DISMISSED_KEY, '2026-10-13T12:00:00.000Z');
    await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    await new PersonsRepo(db).create(withoutId(makePerson(JORDAN)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('marital_filing', {});
    let before: Awaited<ReturnType<typeof savedData>>['rows'] | undefined;
    const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
      before = (await savedData()).rows; // untouched: the first Next is itself a round trip
    });
    expect(saved.rows).toEqual(before);
    expect(filingOf(saved)).toBe('MFJ');
  });

  it("1b marital, re-entered over progress saved by an earlier build (no answer shape): It's more complicated → Head of Household and the partner draft hold", async () => {
    const user = userEvent.setup();
    await new HouseholdRepo(db).update({ filingStatus: 'HOH' });
    startAt('state_city', {
      statuses: { about_you: 'completed', marital_filing: 'completed' }, drafts: { you: YOU, partner: JORDAN },
    });
    await screen.findByRole('heading', { name: /^About you — step 3 of/ });
    const before = await savedData();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: /^About you — step 2 of/ });
    expectComplicatedReRead('Head of Household'); // read from the partner draft (Task 5)
    expect(screen.getByLabelText("Your partner's name")).toHaveValue(JORDAN.name);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: /^About you — step 3 of/ });
    const after = await savedData();
    expect(after.rows).toEqual(before.rows);
    expect(after.progress.drafts.partner).toEqual(JORDAN);
  });

  it("1b marital, Revisit setup after Finish: a partner-less It's more complicated → Head of Household re-reads from the saved status as No, and an untouched Next keeps HOH", async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    // The first run: Yes → It's more complicated → Head of Household, no partner.
    startAt('marital_filing', { statuses: { about_you: 'completed' }, bindings: { you } });
    await screen.findByRole('heading', { name: /^About you — step 2 of/ });
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('radio', { name: "It's more complicated / I'm not sure" }));
    await user.click(screen.getByRole('combobox', { name: /filing status/i }));
    await user.click(await screen.findByRole('option', { name: 'Head of Household' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: /^About you — step 3 of/ });
    expect(loadSetupProgress().drafts.marital).toEqual({ married: 'yes', filing: 'complicated', complicatedStatus: 'HOH' });
    cleanup();
    // Finish clears the progress record, and the recorded answer with it
    // (CX-O3-2 holds within a setup run; after Finish, 1b re-reads from the
    // saved status alone).
    finishSetup(() => {});
    expect(localStorage.getItem(SETUP_PROGRESS_V2_KEY)).toBeNull();
    // Settings → Revisit setup: a fresh revisit-origin record at 1b.
    startAt('marital_filing', { origin: 'revisit' });
    let before: Rows | undefined;
    const saved = await roundTrip(user, /^About you — step 2 of/, /^About you — step 3 of/, async () => {
      expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'I pay more than half the cost of a home for a qualifying dependent' })).toBeChecked();
      before = (await savedData()).rows; // untouched: the first Next is itself a round trip
    });
    expect(saved.rows).toEqual(before);
    expect(filingOf(saved)).toBe('HOH');
    expect(saved.progress.drafts.marital).toEqual({ married: 'no', filing: null, complicatedStatus: null });
  });

  it('1c state and city, Revisit setup (after finish, step not yet asked): an untouched Next keeps New York with New York City', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SETUP_DISMISSED_KEY, '2026-10-13T12:00:00.000Z');
    await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    await new HouseholdRepo(db).update({ state: 'NY', city: 'NY_NYC' });
    startAt('state_city', {});
    let before: Awaited<ReturnType<typeof savedData>>['rows'] | undefined;
    const saved = await roundTrip(user, /^About you — step 3 of/, /^About you — step 4 of/, async () => {
      expect(await screen.findByLabelText('City income tax')).toHaveValue('NY_NYC');
      before = (await savedData()).rows;
    });
    expect(saved.rows).toEqual(before);
    expect(saved.rows.household[0]).toMatchObject({ state: 'NY', city: 'NY_NYC' });
  });

  it('1e expenses, Revisit setup (after finish, step not yet asked): an untouched Next keeps the monthly figure', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SETUP_DISMISSED_KEY, '2026-10-13T12:00:00.000Z');
    await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    await new HouseholdRepo(db).update({ monthlyExpenseBaseline: 4250 });
    startAt('expenses', {});
    let before: Awaited<ReturnType<typeof savedData>>['rows'] | undefined;
    const saved = await roundTrip(user, /^About you — step 5 of/, /^Work & pay — step 1 of/, async () => {
      before = (await savedData()).rows; // untouched
    });
    expect(saved.rows).toEqual(before);
    expect(saved.rows.household[0]).toMatchObject({ monthly_expense_baseline: 4250 });
  });

  it('2a pay:you, an existing person: Hourly, a new rate', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({
      ...YOU, employmentType: 'HOURLY', annualSalaryPretax: 0, hourlyRate: 30, regularHoursPerWeek: 36,
    })));
    startAt('pay', { statuses: PART1_DONE, bindings: { you } }, 'you');
    let before: Rows | undefined;
    const saved = await roundTrip(user, /^Work & pay — step 1 of/, /^Work & pay — step 2 of/, async () => {
      before = (await savedData()).rows;
      await user.clear(screen.getByLabelText('Hourly rate'));
      await user.type(screen.getByLabelText('Hourly rate'), '31.5');
    });
    expect(saved.rows.persons[0]).toMatchObject({ employment_type: 'HOURLY', hourly_rate: 31.5, regular_hours_per_week: 36 });
    expect(saved.rows.persons[0]).toEqual({ ...before!.persons[0], hourly_rate: 31.5 });
  });

  it('2a pay:you, an existing person: Salary with overtime, a new salary', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({
      ...YOU, employmentType: 'SALARY_WITH_OT', annualSalaryPretax: 70000, hourlyRate: 40, otThresholdHoursPerWeek: 40,
    })));
    startAt('pay', { statuses: PART1_DONE, bindings: { you } }, 'you');
    let before: Rows | undefined;
    const saved = await roundTrip(user, /^Work & pay — step 1 of/, /^Work & pay — step 2 of/, async () => {
      before = (await savedData()).rows;
      await user.clear(screen.getByLabelText('Annual salary (pre-tax)'));
      await user.type(screen.getByLabelText('Annual salary (pre-tax)'), '72000');
    });
    expect(saved.rows.persons[0]).toMatchObject({
      employment_type: 'SALARY_WITH_OT', annual_salary_pretax: 72000, hourly_rate: 40, ot_threshold_hours_per_week: 40,
    });
    expect(saved.rows.persons[0]).toEqual({ ...before!.persons[0], annual_salary_pretax: 72000 });
  });

  it('2a pay:you, a legacy Hourly row with a stale salary: an untouched Next writes nothing, so the salary holds (CL-O3-2, D-O3-15)', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson({
      ...YOU, employmentType: 'HOURLY', annualSalaryPretax: 52000, hourlyRate: 25, regularHoursPerWeek: 40,
    })));
    startAt('pay', { statuses: PART1_DONE, bindings: { you } }, 'you');
    let before: Rows | undefined;
    const saved = await roundTrip(user, /^Work & pay — step 1 of/, /^Work & pay — step 2 of/, async () => {
      before = (await savedData()).rows; // untouched: the first Next is itself a round trip
    });
    expect(saved.rows).toEqual(before);
    expect(saved.rows.persons[0]).toMatchObject({ employment_type: 'HOURLY', annual_salary_pretax: 52000, hourly_rate: 25 });
  });

  it('2c benefits:partner: a 401(k) percent and a premium for a saved partner', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    const partner = await new PersonsRepo(db).create(withoutId(makePerson(JORDAN)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('benefits', {
      statuses: { ...PART2_DONE, 'pay:partner': 'completed', 'retirement:partner': 'completed' },
      bindings: { you, partner },
    }, 'partner');
    const saved = await roundTrip(user, /^Work & pay — step 6 of/, /^What you own — step 1 of/, async () => {
      await user.type(screen.getByLabelText(/401\(k\)/), '4');
      await user.type(screen.getByLabelText(/health insurance/), '180');
    });
    expect(saved.rows.persons[1]).toMatchObject({ name: JORDAN.name, pretax_401k_pct: 0.04, health_insurance_monthly_premium: 180 });
  });

  it('2c benefits:partner: HSA No and a $0 premium for a saved partner', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    const partner = await new PersonsRepo(db).create(withoutId(makePerson(JORDAN)));
    await new HouseholdRepo(db).update({ filingStatus: 'MFJ' });
    startAt('benefits', {
      statuses: { ...PART2_DONE, 'pay:partner': 'completed', 'retirement:partner': 'completed' },
      bindings: { you, partner },
    }, 'partner');
    const saved = await roundTrip(user, /^Work & pay — step 6 of/, /^What you own — step 1 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'No' }));
      await user.type(screen.getByLabelText(/health insurance/), '0');
    }, () => {
      expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
      expect(screen.getByLabelText(/health insurance/)).toHaveValue('0');
    });
    expect(saved.rows.persons[1]).toMatchObject({ name: JORDAN.name, hsa_monthly_contribution: 0, health_insurance_monthly_premium: 0 });
    expect(saved.progress.drafts.benefits).toEqual({ partner: { personId: partner, hsa: 'no', zeros: ['premiumMonthly'] } });
  });

  it('rent_gate, shown after a home "No": Yes, with no rows yet', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('rent_gate', { statuses: { ...PART2_DONE, accounts_gate: 'skipped', home_gate: 'skipped' }, bindings: { you } });
    const saved = await roundTrip(user, /^What you own — step 3 of/, /^What you own — step 4 of/, async () => {
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
    });
    expect(saved.progress.gateAnswers.rent_gate).toBe('yes');
  });

  it('goals_gate: Yes with no rows yet, re-entered through the History & goals part chip (it lands on the open gate)', async () => {
    const user = userEvent.setup();
    const you = await new PersonsRepo(db).create(withoutId(makePerson(YOU)));
    startAt('goals_gate', {
      statuses: {
        ...PART2_DONE, accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
        vehicles_gate: 'skipped', equity_gate: 'skipped', loans_gate: 'skipped', import_gate: 'skipped',
      },
      gateAnswers: { import_gate: 'no' },
      bindings: { you },
    });
    await screen.findByRole('heading', { name: /^History & goals — step 2 of/ });
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: "That's everything." });
    const saved = await savedData();
    // A Yes with no rows yet stays open, so the part chip re-enters at the goals gate itself.
    await user.click(screen.getByRole('button', { name: /History & goals/ }));
    await screen.findByRole('heading', { name: /^History & goals — step 2 of/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: "That's everything." });
    expect(await savedData()).toEqual(saved);
    expect(saved.progress.gateAnswers.goals_gate).toBe('yes');
  });
});
