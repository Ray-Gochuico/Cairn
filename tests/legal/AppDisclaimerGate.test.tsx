import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppDisclaimerGate } from '@/legal/AppDisclaimerGate';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { DISCLOSURES } from '@/legal/disclosures';
import { setDatabase } from '@/db/db';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

// Minimal non-null household — the gate's `if (!household) return children`
// guard needs a household, but disclosure acceptance is read from the
// acceptances store (single source of truth, MF-1), NOT a household column
// (those were dropped in 0043).
function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

// Seed the acceptances projection as a COMPLETED load (`status: 'ready'`).
// Without `ready` the gate sits in its loading state and renders neither
// children nor the modal.
function seedAcceptances(acceptedVersions: Record<string, string>) {
  useAcceptancesStore.setState({ acceptedVersions, status: 'ready', isLoading: false, error: null });
}

const CHILD = <div data-testid="app-child">App body</div>;

// Capture the genuine store `load` before any beforeEach mock replaces it, so
// the fail-closed test can run the REAL projection read (which the spy below
// forces to reject) and prove the gate flips to `status: 'error'`.
const realAcceptancesLoad = useAcceptancesStore.getState().load;

function renderGate() {
  return render(
    <MemoryRouter>
      <AppDisclaimerGate>{CHILD}</AppDisclaimerGate>
    </MemoryRouter>,
  );
}

describe('AppDisclaimerGate', () => {
  beforeEach(() => {
    useHouseholdStore.setState({
      household: null,
      isLoading: false,
      error: null,
      // Replace load() with a no-op so the gate's useEffect mount doesn't
      // try to hit a real DB. The tests we care about either preseed the
      // household above OR leave it null deliberately.
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
    // Default: a completed empty load (no acceptances). Replace load() with a
    // no-op so the boot effect doesn't hit a real DB; individual cases seed the
    // accepted versions they need.
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'ready',
      isLoading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('renders children when household has not loaded yet (first-runner pre-wizard)', () => {
    renderGate();
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('does not unmount/loop children when the shared acceptances status transiently flips to loading', async () => {
    // Regression: a child rendered BELOW the gate (TodaysTriviaCard / Learn /
    // SetupWizard) re-loads the shared acceptances store on mount, flipping its
    // status to 'loading'. The gate USED to hide already-admitted children on
    // that transient → unmount → remount → re-load → infinite loop (main-thread
    // saturation; in `tauri dev`, reload cycles that orphan SQL IPC callbacks).
    // The gate now LATCHES the resolved status: a transient 'loading' keeps the
    // prior decision and admitted children stay mounted.
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false, error: null } as any);
    seedAcceptances({ app_wide: DISCLOSURES.app_wide.version }); // gate admits children

    let mounts = 0;
    function ReloadingChild() {
      useEffect(() => {
        mounts += 1;
        // Simulate a child re-loading the shared store: flip to 'loading', then
        // resolve back to 'ready' on a microtask (mirrors load()).
        useAcceptancesStore.setState({ status: 'loading', isLoading: true });
        void Promise.resolve().then(() =>
          useAcceptancesStore.setState({
            acceptedVersions: { app_wide: DISCLOSURES.app_wide.version },
            status: 'ready',
            isLoading: false,
          }),
        );
      }, []);
      return <div data-testid="reloading-child">child</div>;
    }

    render(
      <MemoryRouter>
        <AppDisclaimerGate>
          <ReloadingChild />
        </AppDisclaimerGate>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('reloading-child')).toBeInTheDocument();
    // Let any loop churn.
    await new Promise((r) => setTimeout(r, 100));

    // Still mounted (no flicker to Loading/modal) and mounted a BOUNDED number
    // of times — NOT an unbounded loop (pre-fix this climbed without bound).
    expect(screen.getByTestId('reloading-child')).toBeInTheDocument();
    expect(mounts).toBeLessThan(5);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders children when nothing is accepted yet (first-runner mid-wizard)', () => {
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false, error: null } as any);
    seedAcceptances({});
    renderGate();
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders children when the accepted version matches the current version', () => {
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false, error: null } as any);
    seedAcceptances({ app_wide: DISCLOSURES.app_wide.version });
    renderGate();
    expect(screen.getByTestId('app-child')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Disclaimer' })).toBeNull();
  });

  it('renders the modal (and hides children) when the accepted version is stale (v1.1)', () => {
    // A user on v1.1 (which shipped with the literal [PLACEHOLDER] string
    // in the governing-law sentence) must be re-prompted on the v1.5 bump.
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false, error: null } as any);
    seedAcceptances({ app_wide: '1.1' });
    renderGate();
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).toBeNull();
  });

  it('surfaces a "what changed" hint when the stale version is re-prompted', () => {
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false, error: null } as any);
    seedAcceptances({ app_wide: '1.4' });
    renderGate();
    const changes = screen.getByText(/what changed since you last accepted/i);
    expect(changes).toBeInTheDocument();
    // For v1.5 the disclosures.ts ships an explicit diffFromPrevious that
    // summarizes the drawdown gross-up + frozen-brackets additions; that
    // takes precedence over the fallback.
    expect(
      screen.getByText(/Version 1\.5 adds two new bullets/i),
    ).toBeInTheDocument();
  });

  it('calls acceptDisclaimer when the user accepts the new version', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({
      household: makeHousehold(),
      isLoading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
      acceptDisclaimer,
    } as any);
    // A stale prior acceptance, so the re-prompt modal shows.
    seedAcceptances({ app_wide: '1.4' });
    renderGate();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', DISCLOSURES.app_wide.version);
    });
  });

  it('fails CLOSED: a transient acceptances-load failure re-presents the app_wide disclosure for a household with a prior acceptance', async () => {
    // A returning user who genuinely accepted before — but the projection read
    // throws this boot (the documented self-join race / a transient DB error).
    // A stub DB keeps getDatabase() from throwing before the spied repo method
    // runs; the spy then rejects, exercising the store's FAIL-CLOSED catch.
    setDatabase({
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      select: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(DisclosureAcceptancesRepo.prototype, 'latestVersionsByDocument').mockRejectedValueOnce(
      new Error('transient read failure'),
    );
    // Minimal non-null household (no dropped disclosure fields). Use the REAL
    // acceptances-store load() so the boot effect actually runs it and the
    // rejection flips status to 'error'.
    useHouseholdStore.setState({
      household: makeHousehold(),
      isLoading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'loading',
      isLoading: false,
      error: null,
      load: realAcceptancesLoad,
    } as any);

    renderGate();

    // The boot effect runs load(), which rejects → status 'error' → fail closed.
    // The app_wide disclosure modal is shown; the protected children are NOT.
    expect(await screen.findByRole('heading', { name: DISCLOSURES.app_wide.title })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('fails CLOSED BY CONSTRUCTION: status error blocks even with a CURRENT cached accepted version', () => {
    // The store's catch sets status 'error' WITHOUT clearing acceptedVersions,
    // so a returning user whose prior successful load cached the CURRENT
    // version would make gate.state === 'ready'. The gate must STILL re-prompt
    // on error — proving fail-closed is structural, not an artifact of an empty
    // acceptedVersions map. A no-op load keeps the seeded error state stable
    // through render (this asserts the render decision for a fixed error state;
    // the boot-load→error path is covered by the reject-mock test above).
    useHouseholdStore.setState({
      household: makeHousehold(),
      isLoading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
    useAcceptancesStore.setState({
      acceptedVersions: { app_wide: DISCLOSURES.app_wide.version },
      status: 'error',
      isLoading: false,
      error: 'x',
      load: vi.fn().mockResolvedValue(undefined),
    } as any);

    renderGate();

    // Despite acceptedVersions.app_wide === current (gate.state would be
    // 'ready'), the error status forces the re-prompt modal and hides children.
    expect(screen.getByRole('heading', { name: DISCLOSURES.app_wide.title })).toBeInTheDocument();
    expect(screen.queryByTestId('app-child')).not.toBeInTheDocument();
  });
});
