import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section-4 importer (ImportGateStep, Task 9) pulls the PDF pipeline in via
// the registry; mock before imports, verbatim from SectionLayout.test.tsx.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [],
  }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FlowShell from '@/pages/setup/flow/FlowShell';
import {
  defaultProgressV2,
  loadSetupProgress,
  saveSetupProgress,
  type SetupProgressV2,
} from '@/lib/setup-progress';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useLoansStore } from '@/stores/loans-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { makeHousehold } from '../../../factories';

const householdUpdate = vi.fn(async () => {});
const dependentsCreate = vi.fn(async () => 1);

function primeStores() {
  const base = { isLoading: false, error: null, load: async () => {} };
  usePersonsStore.setState({
    persons: [], update: async () => {}, create: async () => 1, ...base,
  } as never);
  useDependentsStore.setState({ dependents: [], create: dependentsCreate, ...base } as never);
  useAccountsStore.setState({ accounts: [], ...base } as never);
  useHoldingsStore.setState({ holdings: [], ...base } as never);
  usePropertiesStore.setState({ properties: [], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as never);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as never);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
  useSnapshotsStore.setState({ snapshots: [], ...base } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], ...base } as never);
  useContributionsStore.setState({ contributions: [], ...base } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
  useGoalsStore.setState({ goals: [], ...base } as never);
  useHouseholdStore.setState({
    household: makeHousehold(), update: householdUpdate, ...base,
  } as never);
  useTaxRulesStore.setState({
    items: [], year: null, isLoading: false, error: null, loadYear: async () => {},
  } as never);
}

function renderShell(onSwitchView = vi.fn()) {
  render(
    <MemoryRouter>
      <FlowShell onSwitchView={onSwitchView} />
    </MemoryRouter>,
  );
  return { onSwitchView };
}

/** Parts 1+2 complete for a solo run (dependents gate answered No — a
 *  'completed' gate with zero rows would honesty-downgrade to in_progress). */
const PART12_COMPLETE: SetupProgressV2['statuses'] = {
  about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
  dependents_gate: 'skipped', expenses: 'completed',
  'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
};

const ALL_COMPLETE: SetupProgressV2['statuses'] = {
  ...PART12_COMPLETE,
  accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
  vehicles_gate: 'skipped', equity_gate: 'skipped', loans_gate: 'skipped',
  import_gate: 'skipped', goals_gate: 'skipped',
};

describe('FlowShell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    primeStores();
  });

  it('fresh profile renders the CW-2 heading and the CW-3 toggle', async () => {
    renderShell();
    expect(
      await screen.findByRole('heading', { name: 'About you — step 1 of 5' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to form view' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Setup progress' })).toBeInTheDocument();
  });

  it('Next without a name shows a field error and stays on step 1', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'About you — step 1 of 5' }),
    ).toBeInTheDocument();
  });

  it('completing 1a advances to step 2 and moves focus to the heading', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    await user.type(screen.getByLabelText('Your name'), 'Alex Rivera');
    await user.selectOptions(screen.getByLabelText('Your date of birth year'), '1990');
    await user.selectOptions(screen.getByLabelText('Your date of birth month'), '05');
    await user.selectOptions(screen.getByLabelText('Your date of birth day'), '01');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const heading = await screen.findByRole('heading', { name: 'About you — step 2 of 5' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('dependents gate: No renders CW-31a; Next records skipped and creates nothing', async () => {
    const user = userEvent.setup();
    saveSetupProgress({
      ...defaultProgressV2(),
      statuses: {
        about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
      },
      cursor: { stepId: 'dependents_gate' },
    });
    renderShell();
    await screen.findByRole('heading', { name: 'About you — step 4 of 5' });
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(
      screen.getByText(
        'Nothing is recorded — dependents can be added any time under Inputs → Dependents.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'About you — step 5 of 5' });
    expect(loadSetupProgress().statuses.dependents_gate).toBe('skipped');
    expect(dependentsCreate).not.toHaveBeenCalled();
  });

  it('the expenses skip control records skipped and writes NOTHING', async () => {
    const user = userEvent.setup();
    saveSetupProgress({
      ...defaultProgressV2(),
      statuses: {
        about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
        dependents_gate: 'skipped',
      },
      cursor: { stepId: 'expenses' },
    });
    renderShell();
    await screen.findByRole('heading', { name: 'About you — step 5 of 5' });
    expect(
      screen.getByText('Skip and those stay empty until you set it in Household.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip this question' }));
    await screen.findByRole('heading', { name: 'Work & pay — step 1 of 3' });
    expect(loadSetupProgress().statuses.expenses).toBe('skipped');
    expect(householdUpdate).not.toHaveBeenCalled();
  });

  it('resume: Parts 1+2 complete opens at What you own — step 1 of 4', async () => {
    saveSetupProgress({ ...defaultProgressV2(), statuses: PART12_COMPLETE });
    renderShell();
    expect(
      await screen.findByRole('heading', { name: 'What you own — step 1 of 4' }),
    ).toBeInTheDocument();
  });

  it('flow complete renders the CW-8 finish screen', async () => {
    saveSetupProgress({ ...defaultProgressV2(), statuses: ALL_COMPLETE });
    renderShell();
    expect(
      await screen.findByRole('heading', { name: "That's everything." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your answers live in the normal Inputs forms — everything here can be changed there later.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument();
  });

  it('dirty toggle confirms with the CW-5 pair; Stay keeps the entry; Discard switches', async () => {
    const user = userEvent.setup();
    const onSwitchView = vi.fn();
    renderShell(onSwitchView);
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    await user.type(screen.getByLabelText('Your name'), 'A');
    await user.click(screen.getByRole('button', { name: 'Switch to form view' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Discard entries on this step?' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This step has entries that haven't been saved. Saved answers are not affected.",
      ),
    ).toBeInTheDocument();
    // Two options only (the primitive's X-close routes to cancel).
    expect(
      within(dialog).getByRole('button', { name: 'Discard entries on this step' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Stay' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(onSwitchView).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your name')).toHaveValue('A');
    await user.click(screen.getByRole('button', { name: 'Switch to form view' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Discard entries on this step',
      }),
    );
    expect(onSwitchView).toHaveBeenCalledTimes(1);
  });

  it('a pristine step toggles with no dialog', async () => {
    const user = userEvent.setup();
    const onSwitchView = vi.fn();
    renderShell(onSwitchView);
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    await user.click(screen.getByRole('button', { name: 'Switch to form view' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSwitchView).toHaveBeenCalledTimes(1);
  });
});
