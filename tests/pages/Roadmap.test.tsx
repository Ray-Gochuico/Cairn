import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Roadmap from '@/pages/Roadmap';
import { useRoadmap } from '@/domain/roadmap/context';
import { evaluate } from '@/domain/roadmap/evaluate';
import { anyDecisionPrompt } from '@/components/roadmap/DecisionPrompt';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import type { Household } from '@/types/schema';
import { makeHousehold } from '../factories';

// Roadmap document is still on v1.0; app_wide bumped to v1.1 in
// 2026-05-27 to add UCC § 2-316 / US-only / governing-law clauses,
// then to v1.2 to replace the [PLACEHOLDER] string in the governing-
// law clause with "the State of New York", then to v1.3 to add the
// "What this app does NOT model" section.
const ACCEPTED_VERSION = '1.0';


// The roadmap gate reads the acceptances projection (single source of truth,
// MF-1), not a household column. `roadmapAccepted` seeds that projection:
// undefined → no `roadmap` row → gate fires; a version → gate ready when it
// matches DISCLOSURES.roadmap.version.
function resetStores(household: Household | null, roadmapAccepted?: string) {
  useHouseholdStore.setState({
    household,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  useAcceptancesStore.setState({
    acceptedVersions: roadmapAccepted ? { roadmap: roadmapAccepted } : {},
    status: 'ready',
    isLoading: false,
    error: null,
    load: async () => {},
  } as any);
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as any);
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} } as any);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as any);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as any);
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null, load: async () => {} } as any);
  useRoadmapOverridesStore.setState({
    overridesByNodeId: new Map(),
    isLoading: false,
    error: null,
    load: async () => {},
    setOverride: async () => {},
    clearOverride: async () => {},
  } as any);
  // Guided interview (D-GI14): six more stores joined the load gate — prime
  // them the same way so the latched gate settles without touching the DB.
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as any);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: async () => {} } as any);
  useSettingsStore.setState({ settings: null, isLoading: false, error: null, load: async () => {} } as any);
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as any);
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} } as any);
  // Wave T2 (D-HP7): three more stores joined the gate (15 → 18) —
  // properties/housing-payments feed d_tenure, goals feeds the CTA dedup.
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as any);
  useHousingPaymentsStore.setState({ housingPayments: [], isLoading: false, error: null, load: async () => {} } as any);
  useGoalsStore.setState({ goals: [], isLoading: false, error: null, load: async () => {} } as any);
  useInterviewAnswersStore.setState({ answersByKey: new Map(), isLoading: false, error: null, load: async () => {} } as any);
  // Wave T3 (D-T3-7): dependents joined the gate (18 → 19) — feeds the
  // college thread's d_dependents branch.
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: async () => {} } as any);
}

describe('Roadmap page', () => {
  beforeEach(() => {
    resetStores(makeHousehold());
  });

  it('renders the roadmap disclosure modal when the gate is needs-acceptance', () => {
    // No roadmap acceptance in the projection → gate fires.
    resetStores(makeHousehold());
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /about the roadmap/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open roadmap/i })).toBeDisabled();
  });

  it('renders the page content when the gate is ready', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    // Persistent banner is always visible.
    expect(
      screen.getByText(/educational tool — not financial advice/i),
    ).toBeInTheDocument();
    // Section headers are rendered for all 7 sections.
    expect(screen.getByText('Section 0')).toBeInTheDocument();
    expect(screen.getByText('Section 6')).toBeInTheDocument();
    expect(screen.getByText('Budget and Essentials')).toBeInTheDocument();
    // Wave-4 a11y: the page has an h1 landmark heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeInTheDocument();
  });

  it('Wave A C23: the always-visible banner region declares household scope', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/The Roadmap evaluates your household as a whole — both incomes, all accounts\./),
    ).toBeInTheDocument();
  });

  it('renders the status legend above the section cards (W7-UX MF-2)', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    // The legend is a list labelled "Status legend" — both the
    // accessible name and the data-testid hook are stable contracts.
    const legend = screen.getByTestId('roadmap-status-legend');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveAttribute('aria-label', 'Status legend');
  });

  it('shows a setup prompt when the household has not loaded yet', () => {
    resetStores(null);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/set up your household to see your roadmap/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set up household/i })).toHaveAttribute('href', '/inputs/household');
  });

  it('renders the loading skeleton — not engine output or setup copy — while stores load (W10 M28)', () => {
    resetStores(makeHousehold());
    // Household resolved, but accounts still in flight: the engine must NOT
    // evaluate partial stores as authoritative.
    useAccountsStore.setState({ accounts: [], isLoading: true, error: null, load: async () => {} } as any);
    render(<MemoryRouter><Roadmap /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    // No section cards, no evidence strings, no setup empty-state:
    expect(screen.queryByText(/set up your household/i)).not.toBeInTheDocument();
  });

  it('shows StoreErrorBanner with retry when a roadmap input store failed (W10 M28)', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: 'DB gone', load: async () => {} } as any);
    render(<MemoryRouter><Roadmap /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load or save/i);
  });

  it('T2 f6 (D-HP7): mount loads properties, housing payments, and goals exactly once', () => {
    // The cheapest wiring pin: deleting any of the three loads from the
    // reload callback goes RED here while every other test stays green.
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    const loadProperties = vi.fn(async () => {});
    const loadHousingPayments = vi.fn(async () => {});
    const loadGoals = vi.fn(async () => {});
    usePropertiesStore.setState({ load: loadProperties } as any);
    useHousingPaymentsStore.setState({ load: loadHousingPayments } as any);
    useGoalsStore.setState({ load: loadGoals } as any);
    render(<MemoryRouter><Roadmap /></MemoryRouter>);
    expect(loadProperties).toHaveBeenCalledTimes(1);
    expect(loadHousingPayments).toHaveBeenCalledTimes(1);
    expect(loadGoals).toHaveBeenCalledTimes(1);
  });
});

/**
 * ONE PLACE PER THING — smoke defect D2 (main 6ef73e41, 2026-09-02).
 *
 * /what-if's G9 row says "The roadmap has questions you haven't answered" and
 * links to /roadmap. It used to fire on `evaluate(ctx) → any status
 * 'unanswered'`, which is BROADER than what the Roadmap actually offers to
 * answer: rules like s2_small_ef and s1_employer_match report 'unanswered'
 * with evidence and a CTA to some OTHER page and no inline prompt at all. The
 * CTA then landed the user on a page with nothing on it to answer.
 *
 * This renders the real page and the real predicate over the SAME stores and
 * pins them to each other.
 */
function G9Probe() {
  const ctx = useRoadmap();
  if (!ctx) return <div data-testid="g9-probe">no-ctx</div>;
  const results = evaluate(ctx);
  // Left of the slash: what /what-if now asks. Right: the OLD status scan,
  // rendered so the fixture proves the two predicates genuinely disagree.
  const fires = anyDecisionPrompt(results.values());
  const anyUnansweredStatus = [...results.values()].some((r) => r.status === 'unanswered');
  return (
    <div data-testid="g9-probe">
      {`${fires ? 'fires' : 'silent'}/${anyUnansweredStatus ? 'status-unanswered' : 'no-status-unanswered'}`}
    </div>
  );
}

describe('G9 agrees with the Roadmap page (smoke D2)', () => {
  /** Every question the Roadmap can ask with no persons and no accounts on
   *  file, answered. monthlyExpenseBaseline stays 0 so s2_small_ef still
   *  evaluates 'unanswered' — the CTA-only shape with nothing to answer. */
  const ALL_ANSWERED = {
    monthlyExpenseBaseline: 0,
    hasWrittenIps: true,
    hasHsaQualifiedHdhp: false,
    upcomingLargePurchase: false,
    makesCharitableGifts: false,
  };

  /** The Roadmap's own on-page prompts: the Yes/No buttons DecisionPrompt
   *  renders inside the section-card bodies. QuestionBar / InterviewThreads
   *  live outside those bodies and are a separate surface (D-W3-P2). */
  function promptButtons(container: HTMLElement): HTMLElement[] {
    const bodies = Array.from(container.querySelectorAll('[id^="section-"]'))
      .filter((el) => el.id.endsWith('-body'));
    return bodies.flatMap((b) =>
      Array.from(b.querySelectorAll('button')).filter(
        (btn) => btn.textContent === 'Yes' || btn.textContent === 'No',
      ),
    );
  }

  function renderBoth() {
    const view = render(
      <MemoryRouter>
        <Roadmap />
        <G9Probe />
      </MemoryRouter>,
    );
    // Section cards auto-expand only when they hold an ACTIVE node; open the
    // rest so every row the page can show is actually in the DOM.
    for (const toggle of Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    )) {
      fireEvent.click(toggle);
    }
    return view;
  }

  it('every question the page offers is answered → G9 silent, though a node still reads "unanswered"', () => {
    resetStores(makeHousehold(ALL_ANSWERED), ACCEPTED_VERSION);
    const { container } = renderBoth();
    expect(promptButtons(container)).toHaveLength(0);
    // The OLD predicate would have fired here — that is the whole defect.
    expect(screen.getByTestId('g9-probe')).toHaveTextContent('silent/status-unanswered');
  });

  it('one genuinely unanswered question the page surfaces → G9 fires', () => {
    resetStores(makeHousehold({ ...ALL_ANSWERED, hasWrittenIps: null }), ACCEPTED_VERSION);
    const { container } = renderBoth();
    expect(promptButtons(container).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Have you written an Investment Policy Statement (IPS)?'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('g9-probe')).toHaveTextContent('fires/status-unanswered');
  });
});
