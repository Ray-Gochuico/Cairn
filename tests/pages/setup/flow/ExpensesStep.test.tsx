import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import ExpensesStep from '@/pages/setup/flow/steps/ExpensesStep';
import { MIN_COMPLETE_MONTHS } from '@/domain/roadmap/rules/emergencyFund';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { makeHousehold } from '../../../factories';

const BASIS_LINE =
  "We'll use this as your monthly budget on Spending, your expense assumption for FI and projections, and your emergency-fund target until the Roadmap has a complete month of your transactions.";

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-09-06', ...overrides,
  };
}

function renderStep(ctx: FlowCtx) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(<ExpensesStep ctx={ctx} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />);
}

describe('ExpensesStep (1e) — CW-22 question + CR-R1-9 basis line', () => {
  it('asks CW-22 and describes the input with the R1 hand-off rule, verbatim', () => {
    renderStep(ctxWith());
    const input = screen.getByLabelText('About how much does your household spend in a month?');
    expect(input).toHaveAttribute('aria-describedby', 'flow-expenses-basis');
    const basis = screen.getByText(BASIS_LINE);
    expect(basis).toHaveAttribute('id', 'flow-expenses-basis');
  });

  it('never claims a twelve-month hand-off', () => {
    renderStep(ctxWith());
    expect(screen.queryByText(/12 months/)).toBeNull();
  });

  it('CR-R1-9 is written for MIN_COMPLETE_MONTHS = 1 — change the constant and this sentence together (⚑ R1-F2)', () => {
    expect(MIN_COMPLETE_MONTHS).toBe(1);
    expect(BASIS_LINE).toContain('a complete month');
  });
});
