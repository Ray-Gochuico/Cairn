import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section 4 mounts TransactionsSectionImporter, which pulls in the PDF
// extract + parse pipeline. Mock both so SectionLayout can render without
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

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import SectionLayout from '@/pages/setup/SectionLayout';
import {
  isSetupDismissed,
  shouldRedirectToSetup,
} from '@/lib/setup-dismissal';
import { markTailorDone } from '@/lib/onboarding-state';
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
import { useCategoriesStore } from '@/stores/categories-store';
import { makePerson } from '../../factories';

/** Wave C (C1): SectionLayout now hydrates all 15 entity stores behind a
 *  latched useLoadGate — prime each with settled, empty, noop-load state so
 *  every test starts from "loaded and empty" (and no real load hits jsdom). */
function primeStores() {
  const base = { isLoading: false, error: null, load: async () => {} };
  usePersonsStore.setState({ persons: [], ...base } as never);
  useDependentsStore.setState({ dependents: [], ...base } as never);
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
  // The section components read these two beyond the 15 gate stores.
  useHouseholdStore.setState({ household: null, ...base } as never);
  useCategoriesStore.setState({ categories: [], ...base } as never);
}

describe('SectionLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the data stores SectionLayout reads to derive the done-vs-visited
    // badge (H3) so seeded entities don't leak across tests.
    primeStores();
  });

  it('renders a top progress bar with all 4 sections', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const progressNav = screen.getByRole('navigation', {
      name: /setup progress/i,
    });
    expect(progressNav).toBeInTheDocument();
    expect(progressNav.textContent).toMatch(/Who you are/i);
    expect(progressNav.textContent).toMatch(/What you own/i);
    expect(progressNav.textContent).toMatch(/What you owe/i);
    expect(progressNav.textContent).toMatch(/History & goals/i);
  });

  it('starts at Section 1 when localStorage is empty', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('corrupt persisted progress falls back to defaults instead of crashing (W10 T5)', () => {
    localStorage.setItem('setupWizard.progress.v1', JSON.stringify({ currentSection: 2, sectionStatus: 'garbage' }));
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    // defaultProgress() → Section 1, not a crash from the unchecked cast.
    expect(screen.getByRole('heading', { name: /Section 1 of 4/i })).toBeInTheDocument();
  });

  it('persists currentSection to localStorage on advance', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /next section/i }));
    const stored = JSON.parse(
      localStorage.getItem('setupWizard.progress.v1') ?? '{}',
    );
    expect(stored.currentSection).toBe(2);
  });

  it('restores currentSection from localStorage on remount', () => {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'pending',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 3 of 4/i }),
    ).toBeInTheDocument();
  });

  it('clears localStorage on Finish setup (in Section 4)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(localStorage.getItem('setupWizard.progress.v1')).toBeNull();
  });

  it('sets the setup-dismissed marker on Finish so a zero-persons boot does NOT re-redirect (H1)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'skipped',
          2: 'completed',
          3: 'skipped',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(isSetupDismissed()).toBe(false);
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    // Marker persisted…
    expect(isSetupDismissed()).toBe(true);
    // …so the first-launch predicate no longer redirects despite zero persons.
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: isSetupDismissed(), path: '/' }),
    ).toBe(false);
  });

  it('falls back to fresh state when localStorage JSON is malformed', () => {
    localStorage.setItem('setupWizard.progress.v1', '{not json}');
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('shows Previous section disabled on Section 1', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const prev = screen.getByRole('button', { name: /previous section/i });
    expect(prev).toBeDisabled();
  });

  it('auto-advances when the user clicks Skip on the entry gate', async () => {
    // Smoke-test 2026-05-27 finding: clicking "Skip — none of this applies"
    // marked the section as skipped but stayed on the same entry-gate
    // card; users had to also click "Next section" at the bottom of the
    // wizard chrome, which read as the skip not working. Treat skip on
    // the CURRENT section as a one-click mark-and-advance.
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    // Section 1 starts at the entry gate ("Start" / "Skip" buttons).
    await user.click(
      screen.getByRole('button', { name: /skip — none of this applies/i }),
    );
    // Should land on Section 2's heading.
    expect(
      screen.getByRole('heading', { name: /Section 2 of 4/i }),
    ).toBeInTheDocument();
    // localStorage should reflect both: section 1 marked skipped + cursor
    // on section 2.
    const stored = JSON.parse(
      localStorage.getItem('setupWizard.progress.v1') ?? '{}',
    );
    expect(stored.currentSection).toBe(2);
    expect(stored.sectionStatus[1]).toBe('skipped');
  });

  it('shows "visited" (not "✓ done") for a completed section that wrote no entities (H3)', () => {
    // Section 2 (What you own) completed but empty: no accounts/holdings/etc.
    useAccountsStore.setState({ accounts: [] } as never);
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'in_progress',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const section2Chip = screen.getByRole('button', { name: /What you own/i });
    expect(within(section2Chip).queryByText(/✓ done/i)).toBeNull();
    expect(within(section2Chip).getByText(/visited/i)).toBeInTheDocument();
  });

  it('shows "✓ done" for a completed section that wrote at least one entity (H3)', () => {
    // Section 2 completed WITH an account → green "✓ done" implies data exists.
    useAccountsStore.setState({
      accounts: [{ id: 1, name: 'Checking' }],
    } as never);
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'in_progress',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const section2Chip = screen.getByRole('button', { name: /What you own/i });
    expect(within(section2Chip).getByText(/✓ done/i)).toBeInTheDocument();
    expect(within(section2Chip).queryByText(/visited/i)).toBeNull();
  });

  it('moves focus to the section heading when the section changes (M2 a11y)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /next section/i }));
    const heading = screen.getByRole('heading', { name: /Section 2 of 4/i });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('renders "Finish setup" instead of "Next section" on Section 4', () => {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: /next section/i }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /finish setup/i }),
    ).toBeInTheDocument();
  });

  // A tiny probe that renders the current pathname so we can assert where
  // handleFinish navigated.
  function LocationProbe() {
    const { pathname } = useLocation();
    return <div data-testid="pathname">{pathname}</div>;
  }

  function renderAtSection4() {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    return render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SectionLayout />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('handleFinish navigates to /welcome when Tailor is NOT done (new user)', async () => {
    const user = userEvent.setup();
    // Tailor marker absent → onboarding flow runs.
    renderAtSection4();
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(screen.getByTestId('pathname').textContent).toBe('/welcome');
  });

  it('handleFinish navigates to / when Tailor is ALREADY done (existing user via /setup?section=4)', async () => {
    const user = userEvent.setup();
    markTailorDone(); // guard: existing user re-entering the wizard skips onboarding
    renderAtSection4();
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(screen.getByTestId('pathname').textContent).toBe('/');
  });

  it('Wave C C2: a pending section with saved data renders entity cards, not the gate', async () => {
    localStorage.clear(); // no progress key — the post-Finish wiped state
    usePersonsStore.setState({ persons: [makePerson({ id: 1, name: 'Demo Investor' })] } as never);
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('person-chips')).toHaveTextContent('Demo Investor');
    expect(screen.queryByRole('button', { name: 'Start this section' })).not.toBeInTheDocument();
  });

  it('Wave C C3: pending-with-data gets the neutral marker and becomes clickable — never ✓ done', async () => {
    localStorage.clear();
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Brokerage' }] } as never);
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const s2 = await screen.findByRole('button', { name: /Section 2/ });
    expect(s2).toHaveTextContent('has saved data');
    expect(s2).not.toHaveTextContent('✓ done');
    expect(s2).toBeEnabled();
  });

  it('Wave C C2/G6: an explicit initialSection promotes pending → in_progress (deep-link implies start)', async () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <SectionLayout initialSection={4} />
      </MemoryRouter>,
    );
    // Section 4 is empty AND pending, but the deep-link declared intent —
    // the import cards render, not the gate.
    expect(await screen.findByText('Account snapshots')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start this section' })).not.toBeInTheDocument();
  });

  it('Wave C C2 (owner constraint 1): a truly empty pending section still gets the gate — after settle', async () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Start this section' })).toBeInTheDocument();
  });
});
