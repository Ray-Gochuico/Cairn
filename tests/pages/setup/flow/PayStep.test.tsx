import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import PayStep from '@/pages/setup/flow/steps/PayStep';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { usePersonsStore } from '@/stores/persons-store';
import { makeHousehold } from '../../../factories';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [],
    progress: {
      ...defaultProgressV2(),
      drafts: { you: { name: 'Alex Rivera', dateOfBirth: '1990-05-01' } },
    },
    todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(ctx: FlowCtx) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <PayStep ctx={ctx} role="you" asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />,
  );
  return { submitRef };
}

beforeEach(() => {
  usePersonsStore.setState({
    persons: [], isLoading: false, error: null,
    update: async () => {}, create: async () => 1, load: async () => {},
  } as never);
});

describe('PayStep (2a)', () => {
  it('asks CW-24 with the name interpolated; nothing revealed until a type is picked', () => {
    renderStep(ctxWith());
    expect(screen.getByText('How is Alex Rivera paid?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Annual salary (pre-tax)')).toBeNull();
    expect(screen.queryByLabelText('Hourly rate')).toBeNull();
  });

  it('Salary reveals only the salary field', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Salary', exact: true }));
    expect(screen.getByLabelText('Annual salary (pre-tax)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Hourly rate')).toBeNull();
    expect(screen.queryByLabelText('Regular hours / week')).toBeNull();
  });

  it('Hourly reveals rate/hours/threshold and the CW-26 honesty line', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Hourly' }));
    expect(screen.queryByLabelText('Annual salary (pre-tax)')).toBeNull();
    expect(screen.getByLabelText('Hourly rate')).toBeInTheDocument();
    expect(screen.getByLabelText('Regular hours / week')).toBeInTheDocument();
    expect(screen.getByLabelText('OT threshold (hrs / week) — optional')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Alex Rivera's hourly pay is saved, but the Paycheck estimate only covers salaries today — the Overtime calculator covers hourly take-home.",
      ),
    ).toBeInTheDocument();
  });

  it('Salary with overtime reveals every field', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Salary with overtime' }));
    expect(screen.getByLabelText('Annual salary (pre-tax)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hourly rate')).toBeInTheDocument();
    expect(screen.getByLabelText('Regular hours / week')).toBeInTheDocument();
    expect(screen.getByLabelText('OT threshold (hrs / week) — optional')).toBeInTheDocument();
  });

  it('submitting an empty salary flags the field', async () => {
    const user = userEvent.setup();
    const { submitRef } = renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Salary', exact: true }));
    let result: StepSaveResult | undefined;
    await act(async () => {
      result = await submitRef.current!();
    });
    expect(result).toEqual({ ok: false });
    const salary = screen.getByLabelText('Annual salary (pre-tax)');
    expect(salary).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Annual salary is required.')).toBeInTheDocument();
  });
});
