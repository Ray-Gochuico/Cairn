import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Section-4 importer (ImportGateStep) pulls the PDF pipeline in via the
// registry; mock before imports, verbatim from FlowShell.test.tsx.
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
import { defaultProgressV2, saveSetupProgress, type SetupProgressV2 } from '@/lib/setup-progress';
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
import { localTodayISO } from '@/lib/dates';
import type { AccountSnapshot } from '@/types/schema';
import { makeHousehold } from '../../../factories';
import { roadmapReadsOf } from '../../../helpers/roadmap-local-day-reads';

/**
 * v1.7.0 R4 smoke regression: R4 moved the interview kernel onto the LOCAL
 * calendar day, but the wizard's accounts gate still stamped a new balance
 * with the UTC day (FlowShell's one clock read). In the evening west of UTC
 * the UTC day is already tomorrow, so the snapshot sat in the kernel's
 * future: the college reply read "No balance snapshot for the 529 yet" and
 * the stress thread's portfolio dropped it. These arms drive the wizard's
 * production path (the shell's clock → AccountsGateStep → the shared write)
 * and then hand the WRITTEN snapshot to the kernel exactly as the Roadmap
 * injects today (roadmap/context.ts: dateFromLocalISO(useLocalToday())).
 */

const ORIGINAL_TZ = process.env.TZ;

const createWithAnswers = vi.fn(async () => 5);
const snapshotsUpsert = vi.fn(async () => 9);

function primeStores() {
  const base = { isLoading: false, error: null, load: async () => {} };
  usePersonsStore.setState({
    persons: [], update: async () => {}, create: async () => 1, ...base,
  } as never);
  useDependentsStore.setState({ dependents: [], ...base } as never);
  useAccountsStore.setState({
    accounts: [], createWithAnswers, remove: async () => {}, ...base,
  } as never);
  useHoldingsStore.setState({ holdings: [], ...base } as never);
  usePropertiesStore.setState({ properties: [], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as never);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as never);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
  useSnapshotsStore.setState({ snapshots: [], upsert: snapshotsUpsert, ...base } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], ...base } as never);
  useContributionsStore.setState({ contributions: [], ...base } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
  useGoalsStore.setState({ goals: [], ...base } as never);
  useHouseholdStore.setState({
    household: makeHousehold(), update: async () => {}, ...base,
  } as never);
  useTaxRulesStore.setState({
    items: [], year: null, isLoading: false, error: null, loadYear: async () => {},
  } as never);
}

/** Parts 1+2 complete for a solo run; the cursor sits on the accounts gate. */
const PART12_COMPLETE: SetupProgressV2['statuses'] = {
  about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
  dependents_gate: 'skipped', expenses: 'completed',
  'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
};

/** Add one account with a $12,500 balance through the wizard's accounts gate. */
async function addAccountThroughWizard(): Promise<AccountSnapshot> {
  const user = userEvent.setup();
  saveSetupProgress({
    ...defaultProgressV2(),
    statuses: PART12_COMPLETE,
    cursor: { stepId: 'accounts_gate' },
  });
  render(
    <MemoryRouter>
      <FlowShell onSwitchView={vi.fn()} />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('radio', { name: 'Yes' }));
  await user.click(screen.getByRole('button', { name: /add manually/i }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Current balance — optional'), '12500');
  await user.type(within(dialog).getByLabelText('Name', { exact: true }), 'College 529');
  await user.click(within(dialog).getByRole('button', { name: 'Add Account' }));
  await vi.waitFor(() => expect(snapshotsUpsert).toHaveBeenCalledTimes(1));
  const written = (snapshotsUpsert.mock.calls[0] as unknown as [AccountSnapshot])[0];
  expect(written).toMatchObject({ accountId: 5, totalValue: 12500, source: 'MANUAL' });
  return written;
}

describe('the wizard stamps a new balance with the LOCAL day (R4 smoke regression)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    primeStores();
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('New York, 23:33 EDT (03:33 UTC the next day): dated the local 24th, and the Roadmap sees it', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    expect(localTodayISO()).toBe('2026-09-24'); // the arm's premise

    const written = await addAccountThroughWizard();
    // The smoke's symptom first: a UTC-dated (25th) row reads "No balance
    // snapshot for the 529 yet" and drops out of the stress portfolio.
    const { collegeLine, invested } = roadmapReadsOf(written);
    expect(collegeLine).toMatch(/^\$12,500 across 529 accounts plus \$500\/mo grows to/);
    expect(invested).toBe(12_500);
    expect(written.snapshotDate).toBe('2026-09-24');
  });

  it('Auckland, 09:00 NZST (21:00 UTC the previous day): dated the local 25th, ahead of UTC', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    expect(localTodayISO()).toBe('2026-09-25'); // the arm's premise

    const written = await addAccountThroughWizard();
    expect(written.snapshotDate).toBe('2026-09-25');

    const { collegeLine, invested } = roadmapReadsOf(written);
    expect(collegeLine).toMatch(/^\$12,500 across 529 accounts plus \$500\/mo grows to/);
    expect(invested).toBe(12_500);
  });
});
