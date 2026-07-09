import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { usePersonsStore } from '@/stores/persons-store';
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
    dollarMode: 'nominal',
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
