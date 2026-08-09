import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createRef } from 'react';
import LoansGateStep from '@/pages/setup/flow/steps/LoansGateStep';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2, type SetupProgressV2 } from '@/lib/setup-progress';
import { useLoansStore } from '@/stores/loans-store';
import { makeHousehold, makeLoan } from '../../../factories';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}
const progressWith = (patch: Partial<SetupProgressV2>): SetupProgressV2 => ({
  ...defaultProgressV2(), ...patch,
});

function renderStep(ctx: FlowCtx) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <MemoryRouter>
      <LoansGateStep ctx={ctx} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />
    </MemoryRouter>,
  );
  return { submitRef };
}

beforeEach(() => {
  useLoansStore.setState({
    loans: [], isLoading: false, error: null,
    load: async () => {}, create: async () => 1,
  } as never);
});

describe('LoansGateStep', () => {
  it('renders the CW-32 no-judgment intro byte-exact', () => {
    renderStep(ctxWith());
    expect(screen.getByTestId('flow-loans-intro')).toHaveTextContent(
      'Listing what you owe is just for an accurate picture — there is no judgment here.',
    );
  });

  it('skipped-with-data: control forced to Yes with the CW-33 note; loan chips render', () => {
    renderStep(
      ctxWith({
        loans: [makeLoan({ id: 1, name: 'Mortgage' }), makeLoan({ id: 2, name: 'Car loan' })],
        progress: progressWith({ statuses: { loans_gate: 'skipped' } }),
      }),
    );
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    expect(
      screen.getByText('Recorded as skipped earlier — 2 loans exist.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Car loan')).toBeInTheDocument();
  });

  it('the Add-a-loan dialog opens with the canonical LoanForm', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /add manually/i }));
    expect(
      await screen.findByRole('heading', { name: 'Add a loan' }),
    ).toBeInTheDocument();
  });
});
