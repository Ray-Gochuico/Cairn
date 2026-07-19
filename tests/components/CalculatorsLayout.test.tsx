import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CALCULATOR_CARD_IDS } from '@/lib/calculator-card-layout';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoansStore } from '@/stores/loans-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useSettingsStore } from '@/stores/settings-store';
import { FilingStatus } from '@/types/enums';
import type { AppSettings } from '@/types/schema';
import CalculatorsLayout from '@/pages/calculators/CalculatorsLayout';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';

// Federal SINGLE brackets (2026 approximate) — same fixture as the supplemental-pay suite
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

// CA SINGLE brackets (2026 approximate)
const caSingleBrackets = [
  { min: 0,       max: 10412,  rate: 0.01 },
  { min: 10412,   max: 24684,  rate: 0.02 },
  { min: 24684,   max: 38959,  rate: 0.04 },
  { min: 38959,   max: 54081,  rate: 0.06 },
  { min: 54081,   max: 68350,  rate: 0.08 },
  { min: 68350,   max: 349137, rate: 0.093 },
  { min: 349137,  max: 418961, rate: 0.103 },
  { min: 418961,  max: 698271, rate: 0.113 },
  { min: 698271,  max: null,   rate: 0.123 },
];

const basePerson = {
  id: 1,
  householdId: 1,
  name: 'Alex',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY' as const,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
  employmentType: 'SALARY_NO_OT' as const,
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
};

// settings.update is exercised by the toggle tests; stub it to mutate the
// in-memory store so the grid reflects the change (no real DB here).
function primeSettings(calculatorCardLayout: AppSettings['calculatorCardLayout'] = null) {
  const update = vi.fn(async (patch: Partial<AppSettings>) => {
    useSettingsStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, ...patch } : s.settings,
    }));
  });
  useSettingsStore.setState({
    settings: {
      id: 1,
      sidebarLayout: null,
      investmentsCardLayout: null,
      calculatorCardLayout,
      notificationsEnabled: true,
      notificationDay: 1,
      refreshCadence: 'DAILY',
      lastRefreshAt: null,
      statementsFolderPath: null,
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: 'above',
      defaultProjectionDetailLevel: 'tax_bucket',
      defaultCashApy: null,
      defaultCompoundingFrequency: 'MONTHLY',
      defaultDrawdownTaxRate: null,
      propertyUtilitiesCategoryIds: null,
      vehicleGasCategoryIds: null,
      assetClassTargetAllocations: null,
      lastSeenMonth: null,
    } as AppSettings,
    isLoading: false,
    error: null,
    // Override the action so toggles don't hit a real repo.
    update: update as unknown as AppSettings extends never ? never : SettingsUpdate,
  });
  return update;
}
type SettingsUpdate = (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<void>;

function resetStores() {
  // W10 M63/T1: the layout now gates on all 9 hydrated stores via useLoadGate.
  // Seed a no-op load on each so the mount load doesn't flip isLoading (which
  // would leave the gate unsettled → skeleton in these DB-less tests). setState
  // merges, so primeBaseline/primeSettings keep these no-op loads.
  const noop = async () => {};
  useHouseholdStore.setState({ household: null, isLoading: false, error: null, load: noop } as never);
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: noop } as never);
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: noop } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: noop } as never);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: noop } as never);
  useEquityGrantsStore.setState({ equityGrants: [], isLoading: false, error: null, load: noop } as never);
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeBaseline() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
  });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE,
        brackets: federalSingleBrackets,
        standardDeduction: 15000,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE,
        brackets: caSingleBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('CalculatorsLayout', () => {
  beforeEach(() => {
    resetStores();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null, load: async () => {} } as never);
    sessionStorage.clear();
    localStorage.clear();
    // Wave 16: the ScenarioBar's shared-scenario module caches overrides at
    // module level — reset between tests.
    __resetScenarioAssumptionsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the baseline cards (Paycheck, Supplemental pay) when settings + household are set', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: /Paycheck/i, level: 3 })).toBeInTheDocument();
    // Wave 18 B7: Bonus + Commission collapsed into one Supplemental pay card.
    expect(screen.getByRole('heading', { name: /Supplemental pay/i, level: 3 })).toBeInTheDocument();
  });

  it('loads household on mount so the FI card can ever resolve (W10 M63)', () => {
    const load = vi.fn(async () => {});
    primeSettings();
    useHouseholdStore.setState({ household: null, isLoading: false, error: null, load } as never);
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    expect(load).toHaveBeenCalled();
  });

  it('keeps the skeleton up until every hydrated store settles (W10 T1)', () => {
    primeSettings();
    usePersonsStore.setState({ persons: [], isLoading: true, error: null, load: async () => {} } as never);
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    expect(screen.getByTestId('calculators-skeleton')).toBeInTheDocument();
  });

  it('renders OvertimeCard when at least one person has employment_type=HOURLY', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'HOURLY', hourlyRate: 25 }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    expect(await screen.findByText(/^Overtime$/i)).toBeInTheDocument();
  });

  it('does NOT render OvertimeCard when all persons have employment_type=SALARY_NO_OT', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    await screen.findByRole('heading', { name: /Supplemental pay/i, level: 3 });
    expect(screen.queryByText(/^Overtime$/i)).not.toBeInTheDocument();
  });

  describe('stale tax-year banner', () => {
    it('shows stale-year banner when seeded years do not include current calendar year', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      expect(await screen.findByText(/using 2026 tax brackets/i)).toBeInTheDocument();
    });

    it('does NOT show banner when current calendar year is in seeded set', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-01'));
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByRole('heading', { name: /Supplemental pay/i, level: 3 });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Hide / show cards (DB-backed, Switch popover)', () => {
    // Wave-17 Task 4: the per-card header Hide button is deleted chrome — the
    // hide path moves to the shell context (⋯ menu + section Customize),
    // asserted by the Task-5 suite rewrite.

    it('hides a card sourced from settings.calculatorCardLayout (DB read path)', async () => {
      primeBaseline();
      primeSettings([{ id: 'bonus-tax', hidden: true }]);
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByRole('heading', { name: /Paycheck/i, level: 3 });
      // D2: a single hidden legacy entry folds into the merged successor.
      expect(screen.queryByTestId('calc-card-supplemental-pay')).not.toBeInTheDocument();
    });

    it('toggling a hidden card back on (Customize Switch) restores it via update', async () => {
      // Wave 18 B6: a stored legacy pair (both hidden) folds into the merged
      // supplemental-pay id (D2 AND rule); the post-upgrade toggle writes the
      // NEW id list with no legacy entries.
      primeBaseline();
      const update = primeSettings([
        { id: 'bonus-tax', hidden: true },
        { id: 'commission-tax', hidden: true },
      ]);
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByRole('heading', { name: /Paycheck/i, level: 3 });
      expect(screen.queryByTestId('calc-card-supplemental-pay')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /customize paycheck & tax/i }));
      await userEvent.click(screen.getByRole('switch', { name: 'Supplemental pay' }));

      const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
      expect(patch.calculatorCardLayout.find((e) => e.id === 'supplemental-pay')?.hidden).toBe(false);
      // Post-upgrade writes are COMPLETE over the new id list — legacy ids wash out.
      expect(patch.calculatorCardLayout).toHaveLength(10);
      expect(patch.calculatorCardLayout.some((e) => e.id === 'bonus-tax')).toBe(false);
      expect(
        await screen.findByRole('heading', { name: /Supplemental pay/i, level: 3 }),
      ).toBeInTheDocument();
    });
  });

  it('review fix 3: an unrelated toggle PRESERVES the D2 legacy fold (hidden merged cards stay hidden)', async () => {
    // A user upgraded with a legacy 12-entry layout hiding BOTH members of
    // each merged pair. Toggling an UNRELATED card must not resurrect the
    // merged cards — the emitted 10-entry layout keeps the fold's result.
    primeBaseline();
    const update = primeSettings([
      { id: 'paycheck', hidden: false },
      { id: 'bonus-tax', hidden: true },
      { id: 'commission-tax', hidden: true },
      { id: 'overtime', hidden: false },
      { id: 'retirement-401k-withdrawal', hidden: false },
      { id: 'financial-independence', hidden: true },
      { id: 'coast-fi', hidden: true },
      { id: 'compound-interest', hidden: false },
      { id: 'backtest', hidden: false },
      { id: 'debt-payoff', hidden: false },
      { id: 'equity', hidden: false },
      { id: 'contribution-allocator', hidden: false },
    ]);
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    await screen.findByTestId('calc-card-paycheck');
    expect(screen.queryByTestId('calc-card-supplemental-pay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calc-card-path-to-fi')).not.toBeInTheDocument();

    // Toggle an UNRELATED card (hide Paycheck) via the section Customize.
    await userEvent.click(screen.getByRole('button', { name: /customize paycheck & tax/i }));
    await userEvent.click(screen.getByRole('switch', { name: 'Paycheck' }));

    const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
    expect(patch.calculatorCardLayout).toHaveLength(10);
    expect(patch.calculatorCardLayout.find((e) => e.id === 'paycheck')?.hidden).toBe(true);
    // The fold's verdict survives the rewrite over the new id list.
    expect(patch.calculatorCardLayout.find((e) => e.id === 'supplemental-pay')?.hidden).toBe(true);
    expect(patch.calculatorCardLayout.find((e) => e.id === 'path-to-fi')?.hidden).toBe(true);
    expect(patch.calculatorCardLayout.some((e) => e.id === 'bonus-tax')).toBe(false);
  });

  it('renders three labeled sections, cards in registry order (the lock-step assertion)', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'HOURLY', hourlyRate: 25 }],
      isLoading: false, error: null,
    });
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    await screen.findByRole('heading', { name: /paycheck & tax/i, level: 2 });
    expect(screen.getByRole('heading', { name: /path to fi/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /next dollar/i, level: 2 })).toBeInTheDocument();
    // Render order === CALCULATOR_CARD_IDS order (all 10 merged-id cards
    // visible with an OT person — Wave 18 B8 completed the merges).
    const ids = screen.getAllByTestId(/^calc-card-/).map((el) =>
      el.getAttribute('data-testid')!.replace('calc-card-', ''));
    expect(ids).toEqual([...CALCULATOR_CARD_IDS]);
  });

  it('exactly one card open at a time; opening B closes A', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    await screen.findByTestId('calc-card-paycheck');
    await userEvent.click(screen.getByTestId('paycheck-trigger'));
    expect(screen.getByTestId('paycheck-trigger')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByTestId('debt-payoff-trigger'));
    expect(screen.getByTestId('debt-payoff-trigger')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('paycheck-trigger')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('[id^="panel-"]')).toHaveLength(1);
  });

  describe('hash deep-links (D10)', () => {
    afterEach(() => { window.history.replaceState(null, '', '/'); });

    it('#coast-fi on load opens the merged Path to FI card (Wave 18 B6 redirect)', async () => {
      window.history.replaceState(null, '', '/calculators#coast-fi');
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findAllByTestId('calc-card-path-to-fi');
      const triggers = screen.getAllByTestId('path-to-fi-trigger');
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
    });

    it('#bonus-tax (legacy id) redirects to the merged supplemental-pay card (Wave 18 B6)', async () => {
      window.history.replaceState(null, '', '/calculators#bonus-tax');
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findAllByTestId('calc-card-supplemental-pay');
      const triggers = screen.getAllByTestId('supplemental-pay-trigger');
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
    });

    it('a hidden-card hash is ignored silently', async () => {
      window.history.replaceState(null, '', '/calculators#bonus-tax');
      primeBaseline();
      primeSettings([{ id: 'bonus-tax', hidden: true }]);
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByTestId('calc-card-paycheck');
      expect(document.querySelectorAll('[id^="panel-"]')).toHaveLength(0);
    });

    it('#hash open re-scrolls the card AFTER boot layout settles (bounded settle poll, nearest)', async () => {
      // Wave-18 id re-pin: coast-fi merged into path-to-fi (the legacy hash
      // still redirects — both smoke intents exercised in one test).
      window.history.replaceState(null, '', '/calculators#coast-fi');
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      // jsdom has no scrollIntoView — install a recorder on the prototype.
      const scrollCalls: Array<{ id: string; opts: ScrollIntoViewOptions | undefined }> = [];
      (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (
        this: HTMLElement,
        opts?: ScrollIntoViewOptions,
      ) {
        scrollCalls.push({ id: this.id, opts });
      };
      try {
        render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
        await screen.findByTestId('calc-card-path-to-fi');
        const hits = () => scrollCalls.filter((c) => c.id === 'path-to-fi');
        // The card's own open-effect fires once at the open commit…
        expect(hits().length).toBeGreaterThan(0);
        const initialCount = hits().length;
        // …and smoke item 7 pins a SECOND, corrective scroll from the layout
        // once the card's position has been stable across settle ticks —
        // setTimeout-driven (rAF starves in hidden tabs), block:'nearest'.
        await waitFor(
          () => expect(hits().length).toBeGreaterThan(initialCount),
          { timeout: 2000 },
        );
        expect(hits().at(-1)!.opts).toMatchObject({ block: 'nearest' });
      } finally {
        delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('open/close mirrors into the fragment via replaceState', async () => {
      window.history.replaceState(null, '', '/calculators');
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByTestId('calc-card-equity');
      await userEvent.click(screen.getByTestId('equity-trigger'));
      expect(window.location.hash).toBe('#equity');
      await userEvent.click(screen.getByTestId('equity-trigger'));
      expect(window.location.hash).toBe('');
    });
  });

  describe('per-section Customize (replaces Manage cards — D11/D12)', () => {
    it('lists the section cards in registry order and STAYS OPEN across toggles', async () => {
      primeBaseline();
      const update = primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByTestId('calc-card-paycheck');
      await userEvent.click(screen.getByRole('button', { name: /customize paycheck & tax/i }));
      const dialog = screen.getByRole('dialog', { name: /customize paycheck & tax/i });
      const switches = within(dialog).getAllByRole('switch');
      expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
        'Paycheck', 'Supplemental pay', 'Overtime', '401k withdrawal take-home',
      ]);
      await userEvent.click(within(dialog).getByRole('switch', { name: 'Supplemental pay' }));
      // Review fix: the popover does NOT close on toggle.
      expect(screen.getByRole('dialog', { name: /customize paycheck & tax/i })).toBeInTheDocument();
      const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
      expect(patch.calculatorCardLayout.find((e) => e.id === 'supplemental-pay')?.hidden).toBe(true);
      expect(screen.queryByTestId('calc-card-supplemental-pay')).not.toBeInTheDocument();
      // Single source of truth: the legacy localStorage key is NEVER recreated.
      expect(localStorage.getItem('calculator-hidden-cards')).toBeNull();
    });

    it('disables the Overtime row with a reason when no hourly/OT person exists (W10 survives)', async () => {
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByTestId('calc-card-paycheck');
      await userEvent.click(screen.getByRole('button', { name: /customize paycheck & tax/i }));
      const otSwitch = screen.getByRole('switch', { name: /overtime/i });
      expect(otSwitch).toBeDisabled();
      expect(screen.getByText(/add an hourly or salary\+ot person/i)).toBeInTheDocument();
    });

    it('Escape closes Customize and restores focus to its trigger', async () => {
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      const trigger = await screen.findByRole('button', { name: /customize next dollar/i });
      await userEvent.click(trigger);
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: /customize next dollar/i })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('a fully-hidden section keeps its header row and drops the grid (D11 — hide stays reversible)', async () => {
      primeBaseline();
      primeSettings([
        { id: 'debt-payoff', hidden: true },
        { id: 'equity', hidden: true },
        { id: 'contribution-allocator', hidden: true },
      ]);
      usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByTestId('calc-card-paycheck');
      expect(screen.getByRole('heading', { name: /next dollar/i, level: 2 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /customize next dollar/i })).toBeInTheDocument();
      expect(screen.queryByTestId('calc-card-debt-payoff')).not.toBeInTheDocument();
    });
  });

  it('per-segment calc-state keys survive the merge (D12: calc-state:commission-tax preserved)', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    sessionStorage.setItem('calc-state:commission-tax', JSON.stringify({ perCheck: 1234 }));

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Supplemental pay/i, level: 3 });

    expect(sessionStorage.getItem('calc-state:commission-tax')).not.toBeNull();
    expect(sessionStorage.getItem('calc-state:commission')).toBeNull();
    expect(sessionStorage.getItem('calc-state:supplemental-pay')).toBeNull();
  });

  it('D5 (Wave 18): the Next dollar field renders in the next-dollar section header', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({ persons: [{ ...basePerson }], isLoading: false, error: null });
    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    const field = await screen.findByRole('spinbutton', { name: /next dollar/i });
    expect(field).toBeInTheDocument();
    // It lives inside the Next dollar SECTION, not another group.
    const section = field.closest('section')!;
    expect(within(section).getByRole('heading', { name: /next dollar/i, level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(/One number, two answers/i),
    ).toBeInTheDocument();
  });

  it('renders the ScenarioBar between the intro copy and the grid (Wave 16)', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    const bar = await screen.findByRole('region', { name: /your scenario/i });
    const intro = screen.getByText(/All calculators run on your current Inputs data/i);
    // Wave 17: the masonry grid is gone — the bar sits above the FIRST section.
    const firstSection = screen.getByRole('heading', { name: /paycheck & tax/i, level: 2 });
    // intro precedes bar precedes the first section in document order
    expect(intro.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('intro copy describes edit/reset and links to What-If', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    await screen.findByRole('heading', { name: /Calculators/i });
    expect(screen.getByText(/Reset to my data/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /What-If/i })).toHaveAttribute('href', '/what-if');
  });
});
