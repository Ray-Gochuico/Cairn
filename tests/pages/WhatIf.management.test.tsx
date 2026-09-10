import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { usePersonsStore } from '@/stores/persons-store';
import { useHouseholdStore } from '@/stores/household-store';
import { seedWhatIfRealStores } from './whatif-store-seed';

vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: () => <div data-testid="projection-chart-stub" />,
  ProjectionChart: () => <div data-testid="projection-chart-stub" />,
}));

vi.mock('@/components/whatif/MilestoneStrip', () => ({
  default: () => <div data-testid="milestone-strip-stub" />,
  MilestoneStrip: () => <div data-testid="milestone-strip-stub" />,
}));

vi.mock('@/components/whatif/ChartToolbar', () => ({
  default: () => <div data-testid="chart-toolbar-stub" />,
  ChartToolbar: () => <div data-testid="chart-toolbar-stub" />,
}));

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05-01',
    cash: 5000,
    investments: 100000,
    homeEquity: 0,
    incomeAfterTax: 7000,
    expenses: 4000,
    debtByLoan: {},
    loans: [],
    persons: [{ id: 1, name: 'P1', annualSalaryPretax: 100000 }],
    inflation: 0.025,
    defaultReturnRate: 0.07,
  }),
}));

const { setActiveSpy, removeSpy } = vi.hoisted(() => ({
  setActiveSpy: vi.fn(async () => {}),
  removeSpy: vi.fn(async () => {}),
}));

vi.mock('@/stores/scenarios-store', () => {
  const leverPayload = {
    extraLoanPayments: [],
    lumpSums: [],
    expensePeriods: [],
    returns: { defaultRate: 0.07, overrides: {} },
    income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
    contributions: [],
  };
  const baseline = {
    id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
    visible: true, isActive: true, sortOrder: 0, leverPayload, createdAt: '', updatedAt: '',
  };
  const alt = {
    id: 5, name: 'Alt A', isBaseline: false, color: '#ef8b5a', lineStyle: 'solid',
    visible: true, isActive: false, sortOrder: 1, leverPayload, createdAt: '', updatedAt: '',
  };
  const state = {
    scenarios: [baseline, alt],
    activeScenario: () => baseline,
    visibleScenarioIds: () => [1, 5],
    load: vi.fn(),
    projectedScenarios: () => new Map(),
    inflation: 0.025,
    toggleVisibility: vi.fn(),
    setActive: setActiveSpy,
    duplicate: vi.fn(),
    remove: removeSpy,
    rename: vi.fn(),
    saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
  };
  const useScenariosStore = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useScenariosStore.getState = () => state;
  return { useScenariosStore };
});

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: any) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('WhatIf page management surfaces', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    // persons is a REAL store here (not mocked like the sibling files); seed
    // it resolved so the load gate settles synchronously.
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as never);
  });

  it('renders ScenariosPanel in the chart area with Save current + Manage buttons', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // "Baseline" appears in both the panel header and the scenario list row —
    // use getAllByText to accommodate the new inline panel design.
    expect(screen.getAllByText('Baseline').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /save current/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument();
  });

  it('opens the Manage modal when the Manage… button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /manage/i }));
    expect(await screen.findByText(/manage scenarios/i)).toBeInTheDocument();
  });

  it('scenario delete asks for confirmation first (W10 T11)', async () => {
    const user = userEvent.setup();
    removeSpy.mockClear();
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    const moreButtons = screen.getAllByRole('button', { name: /more actions/i });
    await user.click(moreButtons[moreButtons.length - 1]); // Alt A (id 5)
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    // No immediate delete — a confirm dialog gates it.
    expect(removeSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(5));
  });

  it('"Edit Levers" activates the scenario and moves focus to the lever bar (W10 M34)', async () => {
    const user = userEvent.setup();
    setActiveSpy.mockClear();
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // Open the ⋯ menu for the "Alt A" scenario row (the More-actions button).
    const moreButtons = screen.getAllByRole('button', { name: /more actions/i });
    // Rows render in sortOrder; Alt A (id 5) is the second row.
    await user.click(moreButtons[moreButtons.length - 1]);
    await user.click(screen.getByRole('menuitem', { name: /edit levers/i }));
    expect(setActiveSpy).toHaveBeenCalledWith(5);
    await waitFor(() =>
      expect(document.getElementById('whatif-lever-bar')).toHaveFocus(),
    );
  });
});

// Review MINOR 2: the Send-to-What-If arrival scroll was once per MOUNT.
// WhatIf renders the FI-cards row and the projection Card in swapped fragment
// order for the pills-position toggle, so flipping that toggle re-parents the
// Card and REMOUNTS ScenariosPanel — and the ringed row was centered again,
// after a click that had nothing to do with the arrival. The page owns the
// navigation state the id arrives on, so the page consumes the arrival once.
// This is the page WIRING: the panel's own prop is pinned in
// tests/components/whatif/ScenariosPanel.highlight.test.tsx.
describe('WhatIf — the Send arrival scrolls once per ARRIVAL, not once per mount', () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    seedWhatIfRealStores();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    usePersonsStore.setState({
      persons: [{ id: 1, name: 'P1', dateOfBirth: '1990-01-01', targetRetirementAge: 65, annualSalaryPretax: 100000 }],
      isLoading: false, error: null, load: async () => {},
    } as any);
    // The FI-cards row (and with it the pills toggle) renders only with a
    // household on file — it is the remount trigger this pin needs.
    useHouseholdStore.setState({
      household: {
        id: 1, name: null, filingStatus: 'SINGLE', state: 'CA', city: null,
        monthlyExpenseBaseline: 4000, withdrawalRate: 0.04, inflationAssumption: 0.025,
        growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
      },
      isLoading: false, error: null, load: async () => {},
    } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    vi.useFakeTimers();
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    scrollSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    useHouseholdStore.setState({ household: null, isLoading: false, error: null, load: async () => {} } as any);
  });

  it('the FI-pills toggle remounts the panel — the ring stays, the scroll does NOT repeat', () => {
    let container!: HTMLElement;
    act(() => {
      container = render(
        <MemoryRouter initialEntries={[{ pathname: '/what-if', state: { createdScenarioId: 5 } }]}>
          <WhatIf />
        </MemoryRouter>,
      ).container;
    });
    const before = container.querySelector('[data-testid="scenarios-panel"]');
    expect(before!.querySelector('li[data-row-id="5"]')!.className).toContain('ring-1');
    act(() => { vi.advanceTimersByTime(150); });
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Move pills below charts' })); });
    const after = container.querySelector('[data-testid="scenarios-panel"]');
    // Guard: the toggle really does remount the panel — otherwise this pin
    // would pass for the wrong reason.
    expect(after).not.toBe(before);
    expect(after!.querySelector('li[data-row-id="5"]')!.className).toContain('ring-1');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
