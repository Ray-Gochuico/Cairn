import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BacktestParamsForm, BacktestParamsSchema } from '@/components/backtest/BacktestParamsForm';
import type { BacktestConfig } from '@/lib/backtest';

const initial: BacktestConfig = {
  initialPortfolio: 1_500_000, annualSpending: 60_000, horizonYears: 30,
  goalAmount: 500_000, strategy: 'bengen', stockPct: 0.75,
  variableRate: 0.04, minWithdrawal: 48_000, maxWithdrawal: 90_000,
};

describe('BacktestParamsForm', () => {
  it('renders the goal ending amount input', () => {
    render(<BacktestParamsForm initial={initial} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByLabelText(/goal ending amount/i)).toBeInTheDocument();
  });

  it('hides the guardrails advanced block unless strategy is Variable', async () => {
    const user = userEvent.setup();
    render(<BacktestParamsForm initial={initial} onChange={vi.fn()} onRun={vi.fn()} />);
    // Bengen by default → no guardrails fields.
    expect(screen.queryByLabelText(/minimum withdrawal/i)).not.toBeInTheDocument();
    // Switch to Variable (native select per conventions — avoids Radix in tests).
    await user.selectOptions(screen.getByLabelText(/withdrawal strategy/i), 'variable');
    expect(screen.getByLabelText(/minimum withdrawal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/maximum withdrawal/i)).toBeInTheDocument();
  });

  it('fires onRun when the run button is clicked', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<BacktestParamsForm initial={initial} onChange={vi.fn()} onRun={onRun} />);
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it('disables the run button and shows "Running…" while running (BT-8)', () => {
    render(<BacktestParamsForm initial={initial} onChange={vi.fn()} onRun={vi.fn()} isRunning />);
    const btn = screen.getByRole('button', { name: /run backtest/i }); // aria-label is stable
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/running/i);
  });

  it('dollar fields clamp at 0 — negative values cannot be entered (min-clamp gap closed)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BacktestParamsForm initial={initial} onChange={onChange} onRun={vi.fn()} />);
    // Starting portfolio field uses NumberField with min=0 — entering -1 clamps to 0.
    const portfolioInput = screen.getByLabelText(/starting portfolio/i) as HTMLInputElement;
    await user.clear(portfolioInput);
    await user.type(portfolioInput, '-1');
    expect(Number(portfolioInput.value)).toBeGreaterThanOrEqual(0);
    // onChange must have been called with a non-negative initialPortfolio.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as typeof initial;
    expect(lastCall.initialPortfolio).toBeGreaterThanOrEqual(0);
  });

  // BT-4 — the exported schema is what the page validates against before
  // running; min>max (variable) and a NaN/≤0 portfolio must be rejected, valid
  // accepted. This is the contract that keeps run() off the route errorElement.
  it('BacktestParamsSchema rejects degenerate configs and accepts valid ones (BT-4)', () => {
    expect(BacktestParamsSchema.safeParse(initial).success).toBe(true);
    expect(BacktestParamsSchema.safeParse({ ...initial, strategy: 'variable', minWithdrawal: 90_000, maxWithdrawal: 48_000 }).success).toBe(false);
    expect(BacktestParamsSchema.safeParse({ ...initial, initialPortfolio: Number.NaN }).success).toBe(false);
    expect(BacktestParamsSchema.safeParse({ ...initial, initialPortfolio: 0 }).success).toBe(false);
  });
});
