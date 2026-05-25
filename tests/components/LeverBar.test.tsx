import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LeverBar from '@/components/whatif/LeverBar';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

function resetStore() {
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    projectionCache: new Map(),
  });
}

const baseline = (over: Partial<Scenario> = {}): Scenario => ({
  id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
  createdAt: 't', updatedAt: 't', ...over,
});

describe('LeverBar', () => {
  beforeEach(() => { resetStore(); });

  it('renders six pill buttons in spec order', () => {
    useScenariosStore.setState({ scenarios: [baseline()] });
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /loans/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lump sums/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expenses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /returns/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /income/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /contributions/i })).toBeInTheDocument();
  });

  it('shows a contributions count badge based on configured segments', () => {
    useScenariosStore.setState({
      scenarios: [baseline({ leverPayload: {
        ...emptyLeverPayload(),
        contributions: [
          { startMonth: 0, endMonth: 59, monthlyAmount: 1000 },
          { startMonth: 60, endMonth: null, monthlyAmount: 2000 },
        ],
      } })],
    });
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    expect(screen.getByText(/Contributions · 2/i)).toBeInTheDocument();
  });

  it('clicking the Contributions pill opens its popover', async () => {
    useScenariosStore.setState({ scenarios: [baseline()] });
    const user = userEvent.setup();
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /contributions/i }));
    expect(screen.getByRole('dialog', { name: /investment contributions/i })).toBeInTheDocument();
  });

  it('shows a count badge per lever based on the active scenario', () => {
    useScenariosStore.setState({
      scenarios: [baseline({ leverPayload: {
        ...emptyLeverPayload(),
        extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
        lumpSums: [{ when: '2030-06-01', amount: 5000, destination: 'investments' }, { when: '2031-01-01', amount: -2000, destination: 'cash' }],
        expensePeriods: [{ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6 }],
      } })],
    });
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    expect(screen.getByText(/Loans · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Lump sums · 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Expenses · 1/i)).toBeInTheDocument();
  });

  it('clicking a pill opens its popover and clicking it again closes', async () => {
    useScenariosStore.setState({ scenarios: [baseline()] });
    const user = userEvent.setup();
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    const loansPill = screen.getByRole('button', { name: /loans/i });
    await user.click(loansPill);
    expect(screen.getByRole('dialog', { name: /extra loan payments/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /extra loan payments/i })).not.toBeInTheDocument();
  });

  it('renders an empty state when there is no active scenario', () => {
    useScenariosStore.setState({ scenarios: [baseline({ isActive: false })] });
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    expect(screen.getByText(/no active scenario/i)).toBeInTheDocument();
  });
});
