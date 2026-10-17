import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import StateCityStep from '@/pages/setup/flow/steps/StateCityStep';
import type { FlowCtx, StepSaveResult } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { useHouseholdStore } from '@/stores/household-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { makeHousehold } from '../../../factories';

/**
 * v1.8.0 O3 (RC3 variant, CR-O-4): in worded 1c the city used to clear on
 * EVERY keystroke of the two-letter state, so retyping one letter of "NY"
 * passed through "N" and lost New York City for good. It now clears only once
 * the state is a complete two-letter code the city does not match.
 */

const householdUpdate = vi.fn(async (_patch: object) => {});

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold({ state: 'NY', city: 'NY_NYC' }), persons: [], dependents: [],
    accounts: [], properties: [], housingPayments: [], vehicles: [], vehicleLeases: [],
    equityGrants: [], loans: [], transactions: [], goals: [], progress: defaultProgressV2(),
    todayIso: '2026-10-13', ...overrides,
  };
}

function renderStep(ctx: FlowCtx = ctxWith()) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(<StateCityStep ctx={ctx} asked onDirtyChange={vi.fn()} submitRef={submitRef} />);
  return { submitRef };
}

const cityValue = () => (screen.getByLabelText('City income tax') as HTMLSelectElement).value;

beforeEach(() => {
  vi.clearAllMocks();
  useHouseholdStore.setState({
    household: makeHousehold({ state: 'NY', city: 'NY_NYC' }), isLoading: false, error: null,
    update: householdUpdate, load: async () => {},
  } as never);
  useTaxRulesStore.setState({
    year: 2026, isLoading: false, error: null, loadYear: async () => {},
    items: [{
      id: 1, year: 2026, jurisdictionType: 'CITY', jurisdictionCode: 'NY_NYC',
      filingStatus: FilingStatus.SINGLE, brackets: [{ min: 0, max: null, rate: 0.03876 }],
      standardDeduction: 0,
    }],
  } as never);
});

describe('StateCityStep (1c) — the city waits for a complete state (v1.8.0 O3)', () => {
  it('backspacing the state to one letter, a refused Next, and retyping it keep New York City', async () => {
    const user = userEvent.setup();
    const { submitRef } = renderStep();
    const stateInput = screen.getByLabelText('Which state do you live in?');
    expect(cityValue()).toBe('NY_NYC');
    await user.click(stateInput);
    await user.keyboard('{End}{Backspace}');
    expect(stateInput).toHaveValue('N');
    // A one-letter state is refused, and nothing is written.
    expect(await submitRef.current!()).toEqual({ ok: false });
    expect(householdUpdate).not.toHaveBeenCalled();
    await user.keyboard('Y');
    expect(stateInput).toHaveValue('NY');
    expect(cityValue()).toBe('NY_NYC');
    expect(await submitRef.current!()).toEqual({ ok: true });
    expect(householdUpdate).toHaveBeenCalledWith({ state: 'NY', city: 'NY_NYC' });
  });

  it('clearing the whole state and retyping it keeps New York City and leaves the step clean', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
      React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
    render(<StateCityStep ctx={ctxWith()} asked onDirtyChange={onDirtyChange} submitRef={submitRef} />);
    const stateInput = screen.getByLabelText('Which state do you live in?');
    await user.clear(stateInput); // select all + delete: one input event with ''
    expect(stateInput).toHaveValue('');
    await user.type(stateInput, 'NY');
    expect(cityValue()).toBe('NY_NYC');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(await submitRef.current!()).toEqual({ ok: true });
    expect(householdUpdate).toHaveBeenCalledWith({ state: 'NY', city: 'NY_NYC' });
  });

  it('a complete state the city does not match clears the city (designed)', async () => {
    const user = userEvent.setup();
    const { submitRef } = renderStep();
    const stateInput = screen.getByLabelText('Which state do you live in?');
    await user.clear(stateInput);
    await user.type(stateInput, 'NJ');
    // New Jersey has no seeded city rule, so the city select is gone …
    expect(screen.queryByLabelText('City income tax')).toBeNull();
    // … and typing NY again does not bring back a city the user moved away from.
    await user.clear(stateInput);
    await user.type(stateInput, 'NY');
    expect(cityValue()).toBe('');
    expect(await submitRef.current!()).toEqual({ ok: true });
    expect(householdUpdate).toHaveBeenCalledWith({ state: 'NY', city: null });
  });
});
