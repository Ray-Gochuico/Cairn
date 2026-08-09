import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createRef } from 'react';
import MaritalFilingStep from '@/pages/setup/flow/steps/MaritalFilingStep';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { makeHousehold, makePerson } from '../../../factories';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(ctx: FlowCtx, opts: { asked?: boolean; router?: boolean } = {}) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  const ui = (
    <MaritalFilingStep
      ctx={ctx}
      asked={opts.asked ?? false}
      onDirtyChange={vi.fn()}
      submitRef={submitRef}
    />
  );
  render(opts.router ? <MemoryRouter>{ui}</MemoryRouter> : ui);
  return { submitRef };
}

beforeEach(() => {
  const base = { isLoading: false, error: null, load: async () => {} };
  useHouseholdStore.setState({
    household: makeHousehold(), update: async () => {}, ...base,
  } as never);
  usePersonsStore.setState({
    persons: [], update: async () => {}, create: async () => 1, ...base,
  } as never);
});

describe('MaritalFilingStep (1b)', () => {
  it('renders unanswered when never asked, despite the seeded SINGLE household', () => {
    renderStep(ctxWith({ household: makeHousehold({ filingStatus: 'SINGLE' }) }));
    expect(screen.getByText('Are you married?')).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
  });

  it('Yes reveals the filing question (CW-12)', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    expect(screen.queryByText('How do you file taxes?')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByText('How do you file taxes?')).toBeInTheDocument();
  });

  it("the escape hatch reveals the 4-way select with HouseholdForm's labels (CW-13)", async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(
      screen.getByRole('radio', { name: "It's more complicated / I'm not sure" }),
    );
    // The Radix select labelled Filing status opens to the four canonical labels.
    await user.click(screen.getByRole('combobox', { name: /filing status/i }));
    expect(await screen.findByRole('option', { name: 'Single' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Married Filing Jointly' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Married Filing Separately' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Head of Household' })).toBeInTheDocument();
  });

  it('No reveals the CW-14 options with the HOH sub-note', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByRole('radio', { name: 'Single' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', {
        name: 'I pay more than half the cost of a home for a qualifying dependent',
      }),
    ).toBeInTheDocument();
    // Sub-note text wraps the HOH TermTooltip, so match across elements.
    expect(screen.getByText(/Files as/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /head of household/i }),
    ).toBeInTheDocument();
  });

  it('partner fields render on Yes only when no person 2 exists; reuse note otherwise (CW-16/CW-19)', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith({ persons: [makePerson({ id: 1, name: 'Alex' })] }));
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByLabelText("Your partner's name")).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: "Your partner's date of birth" }),
    ).toBeInTheDocument();
  });

  it('conflict mode: two persons + SINGLE renders CW-17 and no married radiogroup (D-WF17)', () => {
    renderStep(
      ctxWith({
        household: makeHousehold({ filingStatus: 'SINGLE' }),
        persons: [makePerson({ id: 1 }), makePerson({ id: 2 })],
      }),
      { router: true },
    );
    expect(
      screen.getByText(/Your saved filing status \(Single\) doesn't match the number of people in this household\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inputs → Household' })).toHaveAttribute(
      'href', '/inputs/household',
    );
    expect(screen.getByRole('link', { name: 'Inputs → People' })).toHaveAttribute(
      'href', '/inputs/persons',
    );
    expect(screen.queryByRole('radio', { name: 'Yes' })).toBeNull();
    // The mechanical escape hatch still lets a status be set.
    expect(screen.getByRole('combobox', { name: /filing status/i })).toBeInTheDocument();
  });

  it('married yes→no flip with a person 2 renders the CW-18 note with their name', async () => {
    const user = userEvent.setup();
    renderStep(
      ctxWith({
        household: makeHousehold({ filingStatus: 'MFJ' }),
        persons: [makePerson({ id: 1, name: 'Alex' }), makePerson({ id: 2, name: 'Sam' })],
      }),
      { asked: true },
    );
    // Prefill said married yes; person 2 exists → reuse note, no partner fields.
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    expect(
      screen.getByText('Sam is already in your household — the work and pay questions will use their row.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(
      screen.getByText('Sam is still in your household — remove them under Inputs → People if needed.'),
    ).toBeInTheDocument();
  });

  it('the CW-15 honesty line is always present', () => {
    renderStep(ctxWith());
    expect(
      screen.getByText(
        "This sets which IRS brackets and caps the estimates use — it doesn't file anything. You can change it any time in Household.",
      ),
    ).toBeInTheDocument();
  });
});
