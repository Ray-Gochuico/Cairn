import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { AccountType, FiPillsPosition, SnapshotSource } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { localTodayISO } from '@/lib/dates';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Account, AccountSnapshot, Household, Person } from '@/types/schema';

// Harness preamble copied from WhatIf.test.tsx (same stubs, same fixtures),
// with the scenario/projection state made mutable via vi.hoisted so each test
// can seed a different pair without a second file.
vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: () => <div data-testid="projection-chart-stub" />,
}));
vi.mock('@/components/whatif/MilestoneStrip', () => ({
  default: () => <div data-testid="milestone-strip-stub" />,
}));
vi.mock('@/components/whatif/ChartToolbar', () => ({
  default: () => <div data-testid="chart-toolbar-stub" />,
}));
vi.mock('@/components/whatif/LeverBar', () => ({
  default: () => <div data-testid="lever-bar-stub" />,
}));
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));

// The roadmap context is inert by default (null → roadmapHasUnanswered false),
// exactly as the plan's Task 6 Step 3 prescribes. Review addition: it is now
// SETTABLE, and `evaluate` is stubbed with a controllable result map, so the
// page's own scan ('unanswered', and the ctx it passes) is pinned too — the
// lib only ever receives the finished boolean.
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => h.roadmapCtx }));
vi.mock('@/domain/roadmap/evaluate', () => ({
  evaluate: (ctx: unknown) => { h.evaluateCalls.push(ctx); return h.roadmapResults; },
}));

const householdFixture: Household = {
  id: 1,
  name: null,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [
    { label: 'Conservative', rate: 0.04 },
    { label: 'Moderate', rate: 0.06 },
  ],
  interestThresholdLowPct: null,
  interestThresholdHighPct: null,
  hasWrittenIps: null,
  hasHsaQualifiedHdhp: null,
  makesCharitableGifts: null,
  upcomingLargePurchase: null,
  upcomingPurchaseAmount: null,
  upcomingPurchaseMonths: null,
} as Household;

const personFixture = {
  id: 1,
  householdId: 1,
  name: 'P1',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
} as unknown as Person;

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05-01',
    cash: 0,
    investmentsByAccount: { 1: 100000 },
    homeEquity: 0,
    incomeAfterTax: 7000,
    expenses: 4000,
    debtByLoan: {},
    loans: [],
    persons: [personFixture],
    inflation: 0.025,
    defaultReturnRate: 0.07,
    // RealState.defaults IS the engine's settings leg (state-snapshot.ts:419)
    // — the page must pass it to the parity fn, never the display deflator
    // (household 2.5% here), or the CR-Y3a honesty appendix silently vanishes.
    defaults: { inflation: 0.03, defaultDrawdownTaxRate: null },
  }),
}));

const payload = () => ({
  extraLoanPayments: [],
  lumpSums: [],
  expensePeriods: [],
  returns: { defaultRate: 0.07, overrides: {}, cashRate: null, compoundingFrequency: 'MONTHLY' },
  income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
  contributions: [],
  gapAllocation: { taxAdvantaged: null, brokerage: null },
  retirementAgeOverride: null,
  swrOverride: null,
  inflation: { defaultRate: null, overrides: {} },
  withdrawalStrategy: 'proportional',
  annualLongTermGains: 0,
  annualQualifiedDividends: 0,
  annualNonQualifiedDividends: 0,
  effectiveDrawdownTaxRate: 0,
  expenseSource: 'custom',
  customMonthly: 0,
});

const h = vi.hoisted(() => ({
  scenarios: [] as unknown[],
  projections: new Map<number, unknown[]>(),
  dollarMode: 'nominal' as 'nominal' | 'real',
  roadmapCtx: null as unknown,
  roadmapResults: new Map<string, { status: string }>(),
  evaluateCalls: [] as unknown[],
}));

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      scenarios: h.scenarios,
      activeScenario: () => h.scenarios[0],
      visibleScenarioIds: () => h.scenarios.map((s) => (s as { id: number }).id),
      load: vi.fn(),
      projectedScenarios: () => h.projections,
      dollarMode: h.dollarMode,
      inflation: 0.025,
      horizonMonths: 360,
      toggleVisibility: vi.fn(),
      setActive: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
      saveCurrentAsScenario: vi.fn().mockResolvedValue(3),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { household: householdFixture, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { persons: [personFixture], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const scenario = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, isBaseline: id === 1, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: id === 1, sortOrder: id - 1, leverPayload: payload(),
  createdAt: '', updatedAt: '', ...over,
});

const state = (netWorth: number) => ({
  monthISO: '2026-05',
  investmentsByAccount: { 1: 200_000 },
  homeEquity: 0,
  cash: 50_000,
  debtByLoan: {},
  netWorth,
  incomeAfterTax: 0,
  expenses: 0,
  savings: 0,
  events: [],
});

function setSettings(over: Record<string, unknown> = {}) {
  useSettingsStore.setState({
    settings: {
      id: 1, sidebarLayout: null, notificationsEnabled: true, notificationDay: 1,
      refreshCadence: 'EVERY_LAUNCH', lastRefreshAt: null, statementsFolderPath: null,
      defaultInflation: null, defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
      ...over,
    },
    isLoading: false, error: null, load: async () => {}, update: async () => {},
  } as never);
}

const renderWhatIf = () => render(<MemoryRouter><WhatIf /></MemoryRouter>);
/** Whole narrative lines are <p> with emphasis spans — read textContent. */
const lineOf = (text: string) =>
  screen.getByText((_t, el) => el?.tagName === 'P' && el.textContent === text);

const brokerage = {
  id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage',
  excludedFromNetWorth: false,
} as unknown as Account;
const snapshotOn = (date: string, source: SnapshotSource): AccountSnapshot => ({
  id: 1, accountId: 3, snapshotDate: date, totalValue: 50_000, source,
});

describe('WhatIf — W3 compare + model-gaps cards', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    h.dollarMode = 'nominal';
    h.roadmapCtx = null;
    h.roadmapResults = new Map();
    h.evaluateCalls = [];
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([
      [1, [state(900_000)]],
      [2, [state(400_000)]],
    ]);
  });

  it('W3 placement: both cards sit between MilestoneStrip and the projection footnote', () => {
    renderWhatIf();
    const strip = screen.getByTestId('milestone-strip-stub');
    const compare = screen.getByTestId('whatif-compare-card');
    const gaps = screen.getByTestId('whatif-model-gaps-card');
    const footnote = screen.getByTestId('whatif-projection-footnote');
    expect(strip.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(compare.compareDocumentPosition(gaps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gaps.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('W3: the picker renders both scenarios, and B never offers A', () => {
    renderWhatIf();
    const selA = screen.getByLabelText('Compare scenario A') as HTMLSelectElement;
    const selB = screen.getByLabelText('Compare scenario B') as HTMLSelectElement;
    expect([...selA.options].map((o) => o.textContent)).toEqual(['Baseline', 'Aggressive payoff']);
    expect([...selB.options].map((o) => o.textContent)).toEqual(['Aggressive payoff']);
  });

  it('W3: single scenario renders the quiet prompt', () => {
    h.scenarios = [scenario(1, 'Baseline')];
    h.projections = new Map<number, unknown[]>([[1, [state(900_000)]]]);
    renderWhatIf();
    expect(screen.getByText('Save a second scenario to compare plans side by side.')).toBeInTheDocument();
  });

  it('W3 scoreboard parity: the BL-3 delta equals the fmtNetWorth30y recipe over both sides', () => {
    h.dollarMode = 'real';
    renderWhatIf();
    // The modal's recipe (ManageScenariosModal.tsx:39-44): disp = n / 1.025^30
    // — displayInflation resolves to household.inflationAssumption here.
    const dispA = 900_000 / Math.pow(1.025, 30);
    const dispB = 400_000 / Math.pow(1.025, 30);
    const delta = `$${Math.round(Math.abs(dispB - dispA)).toLocaleString('en-US')}`;
    expect(delta).toBe('$238,371'); // hand-derived: 500,000 / 2.097567579081786
    expect(
      screen.getByText((_t, el) => el?.tagName === 'P'
        && el.textContent === `Baseline ends ${delta} higher at the 30-year mark (today's dollars).`),
    ).toBeInTheDocument();
  });

  it('W3 nominal mode: no deflator clause and no today\'s-dollars suffix', () => {
    renderWhatIf();
    const card = screen.getByTestId('whatif-compare-card');
    expect(card.textContent).not.toContain('One deflator');
    expect(card.textContent).not.toContain("today's dollars");
    expect(card.textContent).toContain('Same yardstick: dollars are nominal and the horizon is 30 years');
  });

  it('W3: cards absent without projection data (page empty state owns the moment)', () => {
    // hasProjectionData inspects cash / netWorth / investments — zero all three.
    h.projections = new Map<number, unknown[]>([
      [1, [{ ...state(0), cash: 0, investmentsByAccount: {} }]],
      [2, [{ ...state(0), cash: 0, investmentsByAccount: {} }]],
    ]);
    renderWhatIf();
    expect(screen.queryByTestId('whatif-compare-card')).toBeNull();
    expect(screen.queryByTestId('whatif-model-gaps-card')).toBeNull();
  });

  it('W3: the page carries no reserved phrase and no exclamation mark', () => {
    renderWhatIf();
    const page = screen.getByTestId('whatif-page-wrap');
    expect(page.textContent).not.toContain('Suggested next step');
    expect(page.textContent).not.toContain('Note — not a warning.');
    expect(screen.getByTestId('whatif-compare-card').textContent).not.toContain('!');
  });
});

/**
 * Review MAJOR 5 (constraint 8 / D-W3-P2): the three added stores are hydrated
 * by NO boot path — a cold arrival at /what-if with the loads missing renders
 * G4 ("No contributions in the last 12 months") for a user who HAS
 * contributions, and a gate that does not wait on them paints that row for a
 * frame and retracts it (the W10 M33 false-empty flash).
 */
describe('WhatIf — W3 store wiring (loads + latched gate)', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    h.dollarMode = 'nominal';
    h.roadmapCtx = null;
    h.roadmapResults = new Map();
    h.evaluateCalls = [];
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([[1, [state(900_000)]], [2, [state(400_000)]]]);
  });

  it('reload() fires load() on contributions, categories and roadmap overrides', () => {
    const loadContributions = vi.fn();
    const loadCategories = vi.fn();
    const loadRoadmapOverrides = vi.fn();
    useContributionsStore.setState({ load: loadContributions } as never);
    useCategoriesStore.setState({ load: loadCategories } as never);
    useRoadmapOverridesStore.setState({ load: loadRoadmapOverrides } as never);
    renderWhatIf();
    expect(loadContributions).toHaveBeenCalled();
    expect(loadCategories).toHaveBeenCalled();
    expect(loadRoadmapOverrides).toHaveBeenCalled();
  });

  const gateStores = [
    ['contributions', useContributionsStore],
    ['categories', useCategoriesStore],
    ['roadmap overrides', useRoadmapOverridesStore],
  ] as const;
  for (const [name, store] of gateStores) {
    it(`the latched gate waits on ${name}: still loading → the skeleton, no cards`, () => {
      store.setState({ isLoading: true } as never);
      renderWhatIf();
      expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
      expect(screen.queryByTestId('whatif-compare-card')).toBeNull();
      expect(screen.queryByTestId('whatif-model-gaps-card')).toBeNull();
    });
  }
});

/** Page-level plumbing the lib and component tests cannot observe. */
describe('WhatIf — W3 page plumbing', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    h.dollarMode = 'nominal';
    h.roadmapCtx = null;
    h.roadmapResults = new Map();
    h.evaluateCalls = [];
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([[1, [state(900_000)]], [2, [state(400_000)]]]);
  });

  // Review MINOR 12: ONE clock per page. localTodayISO is the LOCAL calendar
  // day every other monthly-pending surface uses; toISOString().slice(0,10)
  // is the UTC day, which flips hours early west of UTC.
  describe('todayIso is the LOCAL calendar day', () => {
    const ORIGINAL_TZ = process.env.TZ;
    beforeEach(() => { process.env.TZ = 'America/Los_Angeles'; });
    afterEach(() => {
      vi.useRealTimers();
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });

    it('at 23:00 local on Aug 31 (Sep 1 UTC), last month is JULY — a confirmed July is silent', () => {
      vi.useFakeTimers();
      const instant = new Date('2026-09-01T06:00:00Z');
      vi.setSystemTime(instant);
      // Guard: the instant must actually split the two implementations.
      expect(localTodayISO(instant)).toBe('2026-08-31');
      expect(instant.toISOString().slice(0, 10)).toBe('2026-09-01');
      useAccountsStore.setState({ accounts: [brokerage] } as never);
      useSnapshotsStore.setState({
        snapshots: [snapshotOn('2026-07-31', SnapshotSource.USER_CONFIRMED)],
      } as never);
      renderWhatIf();
      // The card still renders (G4 fires) — so the absence below is real.
      expect(screen.getByTestId('whatif-model-gaps-card')).toBeInTheDocument();
      expect(screen.queryByText(/Last month's balances aren't confirmed/)).toBeNull();
    });

    it('the same instant DOES surface the row when July was never confirmed', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T06:00:00Z'));
      useAccountsStore.setState({ accounts: [brokerage] } as never);
      useSnapshotsStore.setState({
        snapshots: [snapshotOn('2026-07-31', SnapshotSource.AUTO_DERIVED)],
      } as never);
      renderWhatIf();
      expect(screen.getByText(/Last month's balances aren't confirmed/)).toBeInTheDocument();
    });
  });

  // Review MINOR 1/14: the compared lines start at $200k + $50k cash here, so
  // "the portfolio starts at $0 in these projections" would be false.
  it('G2 stays silent while the compared lines start from a non-zero seed', () => {
    renderWhatIf();
    expect(screen.getByTestId('whatif-model-gaps-card').textContent)
      .not.toContain('No account snapshots yet');
  });

  it('G2 fires when the compared lines really do start at $0', () => {
    h.projections = new Map<number, unknown[]>([
      [1, [{ ...state(900_000), cash: 0, investmentsByAccount: {} }]],
      [2, [{ ...state(400_000), cash: 0, investmentsByAccount: {} }]],
    ]);
    renderWhatIf();
    expect(screen.getByText(/No account snapshots yet/)).toBeInTheDocument();
  });

  // Review REFUTED-2 residual: the page owns the 'unanswered' literal and the
  // context it scans; the lib only ever sees the finished boolean.
  it('G9: the page scans the roadmap context for UNANSWERED nodes', () => {
    h.roadmapCtx = { today: new Date('2026-08-25T12:00:00Z') };
    h.roadmapResults = new Map([['n1', { status: 'unanswered' }]]);
    renderWhatIf();
    expect(screen.getByText(
      "The roadmap has questions you haven't answered — its checklist and frameworks assume less until you do.",
    )).toBeInTheDocument();
    expect(h.evaluateCalls[0]).toBe(h.roadmapCtx);
  });

  it('G9 does not fire for a node that is merely ACTIVE', () => {
    h.roadmapCtx = { today: new Date('2026-08-25T12:00:00Z') };
    h.roadmapResults = new Map([['n1', { status: 'active' }]]);
    renderWhatIf();
    expect(screen.queryByText(/The roadmap has questions/)).toBeNull();
  });

  // Review REFUTED-2 residual: G10 reads the page's Settings object…
  it('G10 stays silent when the Settings drawdown rate IS set', () => {
    setSettings({ defaultDrawdownTaxRate: 0.15 });
    const seq = { ...payload(), withdrawalStrategy: 'sequential' };
    h.scenarios = [scenario(1, 'Baseline', { leverPayload: seq }), scenario(2, 'Aggressive payoff', { leverPayload: seq })];
    renderWhatIf();
    expect(screen.queryByText(/Drawdown tax rate isn't set/)).toBeNull();
  });

  // …and BOTH compared sides, so the one-side row can name the right scenario.
  it('G10n names the sequential side of the compared PAIR', () => {
    const seq = { ...payload(), withdrawalStrategy: 'sequential' };
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff', { leverPayload: seq })];
    renderWhatIf();
    expect(screen.getByText(
      "Drawdown tax rate isn't set — Aggressive payoff's sequential withdrawals are modeled untaxed.",
    )).toBeInTheDocument();
  });

  // Review REFUTED-3 residual: CR-DL1 — the label must resolve from the SAME
  // active scenario effectiveBaselineInflation reads.
  it('the deflator clause names the ACTIVE scenario\'s inflation lever', () => {
    h.dollarMode = 'real';
    const levered = { ...payload(), inflation: { defaultRate: 0.04, overrides: {} } };
    h.scenarios = [scenario(1, 'Baseline', { leverPayload: levered }), scenario(2, 'Aggressive payoff')];
    renderWhatIf();
    expect(lineOf(
      "One deflator: today's-dollar conversion uses one inflation rate — 4%, the active scenario's inflation lever — applied to every line."
      + ' Aggressive payoff is projected at 3% inflation but deflated at 4% here.',
    )).toBeInTheDocument();
  });

  // …and the parity fn must receive the ENGINE's defaults leg, not the display
  // deflator — substituting the latter makes engine ≡ deflator for every
  // household and silently truncates the CR-Y3a honesty appendix.
  it('the CR-Y3a appendix uses RealState.defaults, not the display deflator', () => {
    h.dollarMode = 'real';
    renderWhatIf();
    expect(lineOf(
      "One deflator: today's-dollar conversion uses one inflation rate — 2.5%, your household setting — applied to every line."
      + ' Baseline is projected at 3% inflation but deflated at 2.5% here.'
      + ' Aggressive payoff is projected at 3% inflation but deflated at 2.5% here.',
    )).toBeInTheDocument();
  });

  // ⚑ W3-F3 (review MINOR 9): the just-sent scenario is B on arrival.
  it('B defaults to the highest-sortOrder scenario…', () => {
    h.scenarios = [
      scenario(1, 'Baseline'),
      scenario(2, 'Aggressive payoff', { sortOrder: 5 }),
      scenario(3, 'From calculator', { sortOrder: 1 }),
    ];
    h.projections = new Map<number, unknown[]>([
      [1, [state(900_000)]], [2, [state(400_000)]], [3, [state(500_000)]],
    ]);
    renderWhatIf();
    expect((screen.getByLabelText('Compare scenario B') as HTMLSelectElement).value).toBe('2');
  });

  it('…but the Send-arrival createdScenarioId wins', () => {
    h.scenarios = [
      scenario(1, 'Baseline'),
      scenario(2, 'Aggressive payoff', { sortOrder: 5 }),
      scenario(3, 'From calculator', { sortOrder: 1 }),
    ];
    h.projections = new Map<number, unknown[]>([
      [1, [state(900_000)]], [2, [state(400_000)]], [3, [state(500_000)]],
    ]);
    render(
      <MemoryRouter initialEntries={[{ pathname: '/what-if', state: { createdScenarioId: 3 } }]}>
        <WhatIf />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText('Compare scenario B') as HTMLSelectElement).value).toBe('3');
  });

  it('the picker callbacks are not crossed: choosing A moves A', async () => {
    const user = userEvent.setup();
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff'), scenario(3, 'Third')];
    h.projections = new Map<number, unknown[]>([
      [1, [state(900_000)]], [2, [state(400_000)]], [3, [state(500_000)]],
    ]);
    renderWhatIf();
    await user.selectOptions(screen.getByLabelText('Compare scenario A') as HTMLSelectElement, '3');
    expect((screen.getByLabelText('Compare scenario A') as HTMLSelectElement).value).toBe('3');
  });
});
