import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section 4 mounts TransactionsSectionImporter, which pulls in the PDF
// extract + parse pipeline. Mock both so SetupWizard can render without
// booting pdfjs in jsdom.
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

import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
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
import type { Household } from '@/types/schema';
import { DISCLOSURES } from '@/legal/disclosures';
import SetupWizard from '@/pages/setup/SetupWizard';
import {
  SETUP_PROGRESS_V2_KEY,
  applySectionAdvanced,
  defaultProgressV2,
  loadSetupProgress,
  saveSetupProgress,
} from '@/lib/setup-progress';
import { makeHousehold, makePerson } from '../../factories';


function resetStores(opts: {
  household?: Household | null;
  persons?: Array<{ id: number; name: string }>;
  // The wizard reads app_wide acceptance from the acceptances projection
  // (single source of truth, MF-1), not a household column. Seed it here.
  appWideAccepted?: string;
} = {}) {
  useHouseholdStore.setState({
    household: opts.household ?? null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  useAcceptancesStore.setState({
    acceptedVersions: opts.appWideAccepted ? { app_wide: opts.appWideAccepted } : {},
    status: 'ready',
    isLoading: false,
    error: null,
    load: async () => {},
  } as any);
  usePersonsStore.setState({
    persons: opts.persons ?? [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useTaxRulesStore.setState({
    items: [],
    isLoading: false,
    error: null,
    loadYear: async () => {},
  } as any);
  // The worded FlowShell hydrates ALL 17 stores behind its latched gate —
  // prime the rest to settled-empty-noop so no real load hits jsdom.
  const base = { isLoading: false, error: null, load: async () => {} };
  useAccountsStore.setState({ accounts: [], ...base } as any);
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as any);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
  useLoansStore.setState({ loans: [], ...base } as any);
  useSnapshotsStore.setState({ snapshots: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], ...base } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useTransactionsStore.setState({ transactions: [], ...base } as any);
  useGoalsStore.setState({ goals: [], ...base } as any);
}

function SearchProbe() {
  const { search } = useLocation();
  return <div data-testid="search-probe">{search}</div>;
}

function renderAt(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SetupWizard route handler', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  it('renders Step0Disclaimer first on a fresh visit (no persons, no acceptance)', () => {
    renderAt(['/setup']);
    expect(
      screen.getByRole('heading', { name: /disclaimer/i }),
    ).toBeInTheDocument();
  });

  it('mounts the WORDED flow (not the card wizard) once the disclaimer is accepted', async () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    renderAt(['/setup']);
    expect(
      await screen.findByRole('heading', { name: 'About you — step 1 of 5' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Section 1 of 4/i })).toBeNull();
  });

  it('a fresh /setup?origin=revisit mount persists a revisit-origin record (Wave A item 3, D-WA6)', async () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    renderAt(['/setup?origin=revisit']);
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    expect(JSON.parse(localStorage.getItem(SETUP_PROGRESS_V2_KEY)!).origin).toBe('revisit');
  });

  it('a fresh plain /setup mount persists a first-run record (Wave A item 3)', async () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    renderAt(['/setup']);
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    expect(JSON.parse(localStorage.getItem(SETUP_PROGRESS_V2_KEY)!).origin).toBe('first-run');
  });

  it('?section=4 jumps to Section 4 (FORM view) when persons exist, with the CW-4 toggle', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Switch to guided questions' }),
    ).toBeInTheDocument();
  });

  it('the view toggle round-trips both directions and persists `view`', async () => {
    const user = userEvent.setup();
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    renderAt(['/setup']);
    await screen.findByRole('heading', { name: 'About you — step 1 of 5' });
    await user.click(screen.getByRole('button', { name: 'Switch to form view' }));
    expect(
      await screen.findByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
    expect(loadSetupProgress().view).toBe('form');
    await user.click(screen.getByRole('button', { name: 'Switch to guided questions' }));
    expect(
      await screen.findByRole('heading', { name: 'About you — step 1 of 5' }),
    ).toBeInTheDocument();
    expect(loadSetupProgress().view).toBe('worded');
  });

  it('D2: the toggle under ?section=N clears the param and reaches the worded flow', async () => {
    const user = userEvent.setup();
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
      persons: [{ id: 1, name: 'Alice' }],
    });
    render(
      <MemoryRouter initialEntries={['/setup?section=4']}>
        <Routes>
          <Route path="/setup" element={<><SetupWizard /><SearchProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Section 4 of 4/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to guided questions' }));
    // The worded flow renders and the pinning param is gone (spec: ?section=
    // always OPENS the form view — it must not make the toggle inert). The
    // ?section=4 promotion moved the shared cursor to import_gate, so the
    // flow resumes there (place-keeping), in Part 5.
    expect(
      await screen.findByRole('heading', { name: 'History & goals — step 1 of 2' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to form view' })).toBeInTheDocument();
    expect(screen.getByTestId('search-probe').textContent).toBe('');
  });

  it('a stored view of form (e.g. a migrated v1 user) opens the card wizard directly', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    saveSetupProgress({ ...defaultProgressV2('form') });
    renderAt(['/setup']);
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('form→flow place-keeping: a form-completed Section 1 resumes the flow at What you own', async () => {
    const user = userEvent.setup();
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    usePersonsStore.setState({ persons: [makePerson({ id: 1, name: 'Alex' })] } as any);
    // The card-wizard user added a dependent too — gate honesty would
    // otherwise (correctly) resume at the never-actually-answered
    // dependents gate (completed + zero rows = in_progress, spec rule).
    useDependentsStore.setState({ dependents: [{ id: 1, name: 'Kid' }] } as any);
    // Mid-run card-wizard user: stored view 'form', Section 1 advanced.
    saveSetupProgress(
      applySectionAdvanced(defaultProgressV2('form'), 1, {
        hasPartner: false, homeGateStatus: 'pending', propertiesCount: 0, housingPaymentsCount: 0,
      }),
    );
    renderAt(['/setup']);
    await screen.findByRole('heading', { name: /Section 1 of 4/i });
    await user.click(screen.getByRole('button', { name: 'Switch to guided questions' }));
    expect(
      await screen.findByRole('heading', { name: 'What you own — step 1 of 4' }),
    ).toBeInTheDocument();
  });

  it('waits for persons to load, then honors ?section=4 for a returning household (W10 M47)', async () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    // Persons IN FLIGHT on first render — the old code dropped the param here.
    usePersonsStore.setState({ persons: [], isLoading: true, error: null, load: async () => {} } as any);
    renderAt(['/setup?section=4']);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    // Loads resolve with an existing household:
    act(() => {
      usePersonsStore.setState({ persons: [{ id: 1, name: 'Alice' }], isLoading: false } as any);
    });
    expect(await screen.findByRole('heading', { name: /Section 4 of 4/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Section 1 of 4/i })).not.toBeInTheDocument();
  });

  it('?section=4 is IGNORED when persons-store is empty (fresh user)', () => {
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /disclaimer/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 with persons skips the disclaimer even if not yet accepted', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
  });
});
