import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';
import type { Milestones } from '@/lib/scenarios';

// C2 — the page wiring, pinned end to end: each visible scenario is projected
// through the REAL engine (below), whose per-month authored stamp feeds BOTH
// the FI gate (detectMilestones) and the G11 row (projectionSpending) — the
// page resolves no expense figure of its own, so it cannot fold the
// household's rent into one (C2 review UPHELD 2). "Open Expenses →" activates
// the named scenario and raises the LeverBar open request AFTER activation;
// the page clears the request once the bar has honored it (MINOR 3).
let capturedMilestones: Map<number, Milestones> | null = null;
const leverBarProps: unknown[] = [];

vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: (props: { milestones: Map<number, Milestones> }) => {
    capturedMilestones = props.milestones;
    return <div data-testid="projection-chart-stub" />;
  },
}));
vi.mock('@/components/whatif/MilestoneStrip', () => ({ default: () => <div data-testid="milestone-strip-stub" /> }));
vi.mock('@/components/whatif/ChartToolbar', () => ({ default: () => <div data-testid="chart-toolbar-stub" /> }));
vi.mock('@/components/whatif/LeverBar', () => ({
  default: (props: unknown) => { leverBarProps.push(props); return <div data-testid="lever-bar-stub" />; },
}));
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));
vi.mock('@/components/whatif/FiCards', () => ({ default: () => <div data-testid="fi-cards-stub" /> }));
vi.mock('@/components/whatif/CompareScenariosCard', () => ({ default: () => <div data-testid="compare-stub" /> }));
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => null }));

const household: Household = {
  id: 1, name: null, filingStatus: 'SINGLE', state: 'CA', city: null,
  monthlyExpenseBaseline: 4000, withdrawalRate: 0.04, inflationAssumption: 0.025,
  growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
  interestThresholdLowPct: null, interestThresholdHighPct: null, hasWrittenIps: null,
  hasHsaQualifiedHdhp: null, makesCharitableGifts: null, upcomingLargePurchase: null,
  upcomingPurchaseAmount: null, upcomingPurchaseMonths: null,
} as Household;
const person = { id: 1, householdId: 1, name: 'P1', dateOfBirth: '1990-01-01', targetRetirementAge: 65, annualSalaryPretax: 100000 } as unknown as Person;

const h = vi.hoisted(() => ({
  baseline: 4000,
  expenseBasis: { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 },
  /** Monthly rent on file (a housing payment) — the engine spends it; 0 = none. */
  rent: 2_500,
  scenarios: [] as unknown[],
  setActive: vi.fn(),
}));

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05',
    persons: [person],
    cashAccountsWithBalances: [],
    defaults: { inflation: 0.025, defaultDrawdownTaxRate: null, defaultCashApy: null },
    expenseBasis: h.expenseBasis,
  }),
}));
vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { household: { ...household, monthlyExpenseBaseline: h.baseline }, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { persons: [person], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

/** The engine's RealState for the harness: $3M cash, no income, no returns, no
 *  inflation — so liquid × 4% / 12 = $10,000/mo covers any spending below it
 *  from the first projected month (2026-06). The rent knob is the hazard: a
 *  household obligation the engine spends on top of the scenario's own. */
function engineReal() {
  return {
    accounts: [], holdings: [], loans: [], loanPayments: [], household: { ...household, monthlyExpenseBaseline: h.baseline },
    persons: [{ id: 1, householdId: 1, name: 'P1', dateOfBirth: '1990-01-01', targetRetirementAge: 65, annualSalaryPretax: 0 }],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 3_000_000, initialInvestmentsByAccount: {}, cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-05',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: h.rent > 0
      ? [{ id: 1, householdId: 1, ownerPersonId: null, name: 'Rent', monthlyAmount: h.rent, startDate: '2026-01-01', endDate: null }]
      : [],
    vehicleLeases: [],
    expenseBasis: h.expenseBasis,
  };
}

const payload = (over: Record<string, unknown> = {}) => ({
  extraLoanPayments: [], lumpSums: [], expensePeriods: [],
  returns: { defaultRate: 0, overrides: {}, cashRate: null, compoundingFrequency: 'MONTHLY' },
  income: { perPerson: [{ annualRaiseRate: 0, events: [] }] }, contributions: [],
  gapAllocation: { taxAdvantaged: null, brokerage: null }, retirementAgeOverride: null, swrOverride: null,
  inflation: { defaultRate: null, overrides: {} }, withdrawalStrategy: 'proportional',
  annualLongTermGains: 0, annualQualifiedDividends: 0, annualNonQualifiedDividends: 0, effectiveDrawdownTaxRate: 0,
  expenseSource: 'custom', customMonthly: 0, ...over,
});
const scenario = (id: number, name: string, over: Record<string, unknown> = {}, lever: Record<string, unknown> = {}) => ({
  id, name, isBaseline: id === 1, color: '#4f86f7', lineStyle: 'solid', visible: true, isActive: id === 1,
  sortOrder: id - 1, leverPayload: payload(lever), createdAt: '', updatedAt: '', ...over,
});

vi.mock('@/stores/scenarios-store', async () => {
  const { projectScenario } = await vi.importActual<typeof import('@/lib/scenarios/engine')>('@/lib/scenarios/engine');
  type Sc = { id: number; visible: boolean; leverPayload: never };
  const stateOf = () => ({
    scenarios: h.scenarios,
    activeScenario: () => h.scenarios[0],
    visibleScenarioIds: () => (h.scenarios as Sc[]).filter((s) => s.visible).map((s) => s.id),
    load: vi.fn(),
    // Visible scenarios only (the store's own rule), each through the REAL engine.
    projectedScenarios: () => new Map((h.scenarios as Sc[]).filter((s) => s.visible).map((s) => [
      s.id, projectScenario(engineReal() as never, s.leverPayload, { startISO: '2026-05', months: 24 }),
    ])),
    inflation: 0.025, horizonMonths: 360,
    toggleVisibility: vi.fn(), setActive: h.setActive, duplicate: vi.fn(), remove: vi.fn(), rename: vi.fn(),
    saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
  });
  const useScenariosStore = (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = stateOf();
    return typeof selector === 'function' ? selector(state) : state;
  };
  useScenariosStore.getState = stateOf;
  return { useScenariosStore };
});

import WhatIf from '@/pages/WhatIf';

const renderPage = () => render(<MemoryRouter><WhatIf /></MemoryRouter>);
// C2 review (MINOR 1): two byte-exact variants, chosen by what the engine spends.
const G11_NOTHING = (name: string) => `${name}'s expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.`;
const G11_OBLIGATIONS = (name: string) => `${name}'s expense base is $0 — the projection counts only rent and vehicle leases as spending, so no FI date is shown.`;
const fiOf = (id: number) => capturedMilestones!.get(id)!.financialIndependenceISO;
type LeverBarStubProps = { openRequest: { lever: string; nonce: number } | null; onOpenRequestConsumed?: (nonce: number) => void };
const lastBar = () => leverBarProps.at(-1) as LeverBarStubProps;

describe('WhatIf — C2 page wiring: the per-month FI gate + G11 read the engine\'s own authored stamp', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    capturedMilestones = null;
    leverBarProps.length = 0;
    h.baseline = 4000;
    h.rent = 2_500;
    h.expenseBasis = { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 };
    h.setActive = vi.fn().mockResolvedValue(undefined);
    h.scenarios = [scenario(1, 'Baseline')];
  });

  it('THE HAZARD: a custom/$0 scenario with rent on file reads NO FI (the engine spends rent alone) — G11 names it, saying rent and leases are what is counted', () => {
    renderPage();
    expect(fiOf(1)).toBeUndefined();
    expect(screen.getByText(G11_OBLIGATIONS('Baseline'))).toBeInTheDocument();
    expect(screen.queryByText(G11_NOTHING('Baseline'))).toBeNull();
  });

  it('nothing on file: a custom/$0 scenario spends nothing — G11 says the projection assumes nothing is spent', () => {
    h.rent = 0;
    renderPage();
    expect(fiOf(1)).toBeUndefined();
    expect(screen.getByText(G11_NOTHING('Baseline'))).toBeInTheDocument();
  });

  it('the gate reads the RESOLVED base: a rolling12m scenario with a captured average keeps its FI date, and G11 is silent', () => {
    h.expenseBasis = { latestMonth: 5000, rolling12m: 5000, rolling12mMonths: 3 };
    h.scenarios = [scenario(1, 'Baseline', {}, { expenseSource: 'rolling12m' })];
    renderPage();
    expect(fiOf(1)).toBe('2026-06');                  // $10,000 capacity ≥ $5,000 + $2,500 rent
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('a rolling12m scenario with NO complete month resolves $0 — gated, named (rent on file does not make it authored)', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expenseSource: 'rolling12m' })];
    renderPage();
    expect(fiOf(1)).toBeUndefined();
    expect(screen.getByText(G11_OBLIGATIONS('Baseline'))).toBeInTheDocument();
  });

  it('periods COUNT (B5): a custom/$0 scenario with a period from the start month keeps its FI date; G11 silent', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expensePeriods: [{ start: '2026-05-01', monthlyDelta: 3_000, durationMonths: 480 }] })];
    renderPage();
    expect(fiOf(1)).toBe('2026-06');
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('UPHELD 1: a period starting TODAY (mid-month in the start month — the "+ Add period" default) is spent from the first projected month; FI shown, G11 silent', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expensePeriods: [{ start: '2026-05-24', monthlyDelta: 3_000, durationMonths: 480 }] })];
    renderPage();
    expect(fiOf(1)).toBe('2026-06');
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('MINOR 0/4: a period starting a year out — no FI on rent alone before it, FI on its first month; G11 silent (the projection does spend it)', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expensePeriods: [{ start: '2027-05-01', monthlyDelta: 3_000, durationMonths: 480 }] })];
    renderPage();
    expect(fiOf(1)).toBe('2027-05');
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('UPHELD 0: a temporary period that ENDS on a $0 base — no FI from the rent-alone months after it', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expensePeriods: [{ start: '2026-05-01', monthlyDelta: 20_000, durationMonths: 3 }] })];
    renderPage();
    expect(fiOf(1)).toBeUndefined();
  });

  it('G11 is per VISIBLE scenario in strip order; a hidden $0 scenario is neither projected nor named', () => {
    h.scenarios = [
      scenario(1, 'Baseline', {}, { customMonthly: 4_000 }),
      scenario(2, 'Sent', {}),
      scenario(3, 'Hidden', { visible: false }),
    ];
    renderPage();
    expect(screen.getByText(G11_OBLIGATIONS('Sent'))).toBeInTheDocument();
    expect(screen.queryByText(/Hidden's expense base/)).toBeNull();
    expect(screen.queryByText(/Baseline's expense base/)).toBeNull();
  });

  it('a $0 HOUSEHOLD baseline: G1, not G11 — and no FI either way', () => {
    h.baseline = 0;
    renderPage();
    expect(screen.getByText("No monthly expense baseline — FI dates can't be computed, so they aren't shown.")).toBeInTheDocument();
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
    expect(fiOf(1)).toBeUndefined();
  });

  it('"Open Expenses →" activates the NAMED scenario first, then raises the Expenses open request on the LeverBar', async () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { customMonthly: 4_000 }), scenario(2, 'Sent', {})];
    renderPage();
    expect(lastBar().openRequest).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    expect(h.setActive).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(lastBar().openRequest).toEqual({ lever: 'expenses', nonce: 1 });
    });
    // a second request carries a fresh nonce (the bar re-opens a dialog the user closed)
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    await waitFor(() => {
      expect(lastBar().openRequest!.nonce).toBe(2);
    });
  });

  it('the Expenses request WAITS for activation: nothing is raised while setActive is pending (the dialog must open on the named scenario)', async () => {
    let settle!: () => void;
    h.setActive = vi.fn(() => new Promise<void>((r) => { settle = r; }));
    h.scenarios = [scenario(1, 'Baseline', {}, { customMonthly: 4_000 }), scenario(2, 'Sent', {})];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    expect(h.setActive).toHaveBeenCalledWith(2);
    await new Promise((r) => setTimeout(r, 50));   // several frames: activation still pending
    expect(lastBar().openRequest).toBeNull();
    settle();
    await waitFor(() => {
      expect(lastBar().openRequest).toEqual({ lever: 'expenses', nonce: 1 });
    });
  });

  it('MINOR 3: once the bar reports the request honored, the page CLEARS it — a remounted bar has nothing to replay', async () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { customMonthly: 4_000 }), scenario(2, 'Sent', {})];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    await waitFor(() => expect(lastBar().openRequest).toEqual({ lever: 'expenses', nonce: 1 }));
    // a stale report (an older nonce) never clears a newer request
    act(() => { lastBar().onOpenRequestConsumed!(0); });
    expect(lastBar().openRequest).toEqual({ lever: 'expenses', nonce: 1 });
    act(() => { lastBar().onOpenRequestConsumed!(1); });
    expect(lastBar().openRequest).toBeNull();
  });

  it('the page carries no reserved phrase and no exclamation mark on the G11 surface', () => {
    renderPage();
    const card = screen.getByTestId('whatif-model-gaps-card');
    expect(card.textContent).not.toContain('Suggested next step');
    expect(card.textContent).not.toContain('!');
  });
});
