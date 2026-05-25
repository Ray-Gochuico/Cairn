import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';

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

vi.mock('@/stores/scenarios-store', () => {
  const baseline = {
    id: 1,
    name: 'Baseline',
    isBaseline: true,
    color: '#4f86f7',
    lineStyle: 'solid',
    visible: true,
    isActive: true,
    sortOrder: 0,
    leverPayload: {
      extraLoanPayments: [],
      lumpSums: [],
      expensePeriods: [],
      returns: { defaultRate: 0.07, overrides: {} },
      income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
    },
    createdAt: '',
    updatedAt: '',
  };
  return {
    useScenariosStore: (selector?: any) => {
      const state = {
        scenarios: [baseline],
        activeScenario: () => baseline,
        visibleScenarioIds: () => [1],
        load: vi.fn(),
        projectedScenarios: () => new Map(),
        dollarMode: 'nominal',
        inflation: 0.025,
        toggleVisibility: vi.fn(),
        setActive: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        rename: vi.fn(),
        saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
      };
      return typeof selector === 'function' ? selector(state) : state;
    },
  };
});

vi.mock('@/stores/loans-store', () => ({ useLoansStore: () => ({ loans: [] }) }));

describe('WhatIf page management surfaces', () => {
  it('renders ScenariosPanel in the chart area with Save current + Manage buttons', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(screen.getByText('Baseline')).toBeInTheDocument();
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
});
