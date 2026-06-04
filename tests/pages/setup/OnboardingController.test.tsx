import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ---- Mock the pure engine (Task A): controlled results per test. -----------
const mockComputeTailoring = vi.fn();
const mockHasAnyHideRecommendation = vi.fn();
vi.mock('@/lib/onboarding-tailoring', () => ({
  computeTailoring: (...args: unknown[]) => mockComputeTailoring(...args),
  hasAnyHideRecommendation: (...args: unknown[]) =>
    mockHasAnyHideRecommendation(...args),
}));

// ---- Mock the Tailor step (Task B1): a marker we can detect mounting. ------
vi.mock('@/components/onboarding/TailorStep', () => ({
  TailorStep: (props: { onDone: () => void; onSkip: () => void }) => (
    <div data-testid="tailor-step">
      <button type="button" onClick={props.onDone}>
        tailor-done
      </button>
      <button type="button" onClick={props.onSkip}>
        tailor-skip
      </button>
    </div>
  ),
}));

// ---- Mock the tour store (Task D): assert start() is called. ---------------
const mockTourStart = vi.fn();
vi.mock('@/stores/tour-store', () => ({
  useTourStore: Object.assign(() => ({ start: mockTourStart }), {
    getState: () => ({ start: mockTourStart }),
  }),
}));

import OnboardingController from '@/pages/setup/OnboardingController';
import {
  isTailorDone,
  isTourDone,
} from '@/lib/onboarding-state';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useLoansStore } from '@/stores/loans-store';

// Minimal TailoringResult shapes (the controller only reads what it passes
// through + asks hasAnyHideRecommendation about; the engine is mocked).
const RESULT_WITH_RECS = {
  tabs: [{ to: '/vehicles', label: 'Vehicles', visible: false, reason: 'no vehicles entered' }],
  calculators: [],
};
const RESULT_NO_RECS = { tabs: [], calculators: [] };

/**
 * Stub every entity store's load() to resolve immediately and to NOT flip
 * isLoading (we control isLoading via setState per test). Returning a resolved
 * promise lets the controller's Promise.allSettled settle on the next tick.
 */
function stubLoads() {
  const noop = vi.fn().mockResolvedValue(undefined);
  usePersonsStore.setState({ load: noop } as never);
  useAccountsStore.setState({ load: noop } as never);
  useHoldingsStore.setState({ load: noop } as never);
  usePropertiesStore.setState({ load: noop } as never);
  useVehiclesStore.setState({ load: noop } as never);
  useEquityGrantsStore.setState({ load: noop } as never);
  useLoansStore.setState({ load: noop } as never);
}

/** Put all 7 stores in a given (loading + error) posture with empty arrays. */
function setAllStores(opts: { loading: boolean; error?: string | null }) {
  const base = { isLoading: opts.loading, error: opts.error ?? null };
  usePersonsStore.setState({ persons: [], ...base } as never);
  useAccountsStore.setState({ accounts: [], ...base } as never);
  useHoldingsStore.setState({ holdings: [], ...base } as never);
  usePropertiesStore.setState({ properties: [], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
}

function renderController() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <OnboardingController />
    </MemoryRouter>,
  );
}

describe('OnboardingController', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    stubLoads();
    // Default: everything still loading (no resolution) for the synchronous
    // first-render assertions; individual tests resolve as needed.
    setAllStores({ loading: true });
    mockHasAnyHideRecommendation.mockReturnValue(false);
    mockComputeTailoring.mockReturnValue(RESULT_NO_RECS);
  });

  it('renders the "You\'re set up" card IMMEDIATELY, data-independent', () => {
    renderController();
    // Celebratory beat is present on the very first paint (no spinner gate).
    expect(
      screen.getByRole('heading', { name: /you'?re set up/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /skip setup help/i }),
    ).toBeInTheDocument();
  });

  it('shows a placeholder "Step 1" with NO "of N" while stores are loading (no phantom denominator)', () => {
    // N will be 2 here (no recs), but it must NOT leak before stores resolve.
    setAllStores({ loading: true });
    renderController();
    // Synchronous first render: "Step 1" present, "of N" absent.
    const indicator = screen.getByTestId('onboarding-step-indicator');
    expect(indicator.textContent).toMatch(/step\s*1/i);
    expect(indicator.textContent).not.toMatch(/of\s*\d/i);
    // And specifically: no wrong "of 3" / "of 2" phantom.
    expect(indicator.textContent).not.toMatch(/of\s*3/i);
  });

  it('resolved with hide-recs → N=3 and clicking Continue mounts TailorStep', async () => {
    const user = userEvent.setup();
    setAllStores({ loading: false });
    mockComputeTailoring.mockReturnValue(RESULT_WITH_RECS);
    mockHasAnyHideRecommendation.mockReturnValue(true);
    renderController();

    // Once resolved, the denominator fills in to 3.
    await waitFor(() => {
      expect(
        screen.getByTestId('onboarding-step-indicator').textContent,
      ).toMatch(/step\s*1\s*of\s*3/i);
    });

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('tailor-step')).toBeInTheDocument();
    // Continue into Tailor must NOT have started the tour or navigated.
    expect(mockTourStart).not.toHaveBeenCalled();
  });

  it('resolved with NO hide-recs → N=2 and Continue skips Tailor straight to the tour', async () => {
    const user = userEvent.setup();
    setAllStores({ loading: false });
    mockComputeTailoring.mockReturnValue(RESULT_NO_RECS);
    mockHasAnyHideRecommendation.mockReturnValue(false);
    renderController();

    await waitFor(() => {
      expect(
        screen.getByTestId('onboarding-step-indicator').textContent,
      ).toMatch(/step\s*1\s*of\s*2/i);
    });

    await user.click(screen.getByRole('button', { name: /continue/i }));
    // No Tailor mount; tour started instead.
    expect(screen.queryByTestId('tailor-step')).not.toBeInTheDocument();
    await waitFor(() => expect(mockTourStart).toHaveBeenCalledTimes(1));
  });

  it('ONE errored store → N stays consistent with forced-visible (Tailor NOT skipped)', async () => {
    const user = userEvent.setup();
    // All resolved, but properties errored. The engine (mocked) would say
    // "no recs", yet the controller must FORCE the errored group visible and
    // therefore treat the run as having a recommendation surface → N=3, Tailor
    // mounts (never silently collapse to 2 on an errored read).
    setAllStores({ loading: false });
    usePropertiesStore.setState({
      properties: [],
      isLoading: false,
      error: 'boom',
    } as never);
    // Engine returns no recs; the controller's error-forcing is what bumps N.
    mockComputeTailoring.mockReturnValue(RESULT_NO_RECS);
    mockHasAnyHideRecommendation.mockReturnValue(false);
    renderController();

    await waitFor(() => {
      expect(
        screen.getByTestId('onboarding-step-indicator').textContent,
      ).toMatch(/step\s*1\s*of\s*3/i);
    });

    await user.click(screen.getByRole('button', { name: /continue/i }));
    // Errored read must reach Tailor (its retry lives there), not skip it.
    expect(await screen.findByTestId('tailor-step')).toBeInTheDocument();
    expect(mockTourStart).not.toHaveBeenCalled();
  });

  it('Skip setup help → sets BOTH markers (tailor + tour), no Tailor, no tour start', async () => {
    const user = userEvent.setup();
    setAllStores({ loading: false });
    renderController();

    await user.click(screen.getByRole('button', { name: /skip setup help/i }));
    expect(isTailorDone()).toBe(true);
    expect(isTourDone()).toBe(true);
    expect(screen.queryByTestId('tailor-step')).not.toBeInTheDocument();
    expect(mockTourStart).not.toHaveBeenCalled();
  });

  it('calls computeTailoring exactly ONCE after stores resolve', async () => {
    setAllStores({ loading: false });
    mockComputeTailoring.mockReturnValue(RESULT_NO_RECS);
    mockHasAnyHideRecommendation.mockReturnValue(false);
    renderController();
    await waitFor(() =>
      expect(mockComputeTailoring).toHaveBeenCalledTimes(1),
    );
  });
});
