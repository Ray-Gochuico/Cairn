import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import PayStep from '@/pages/setup/flow/steps/PayStep';
import RetirementStep from '@/pages/setup/flow/steps/RetirementStep';
import BenefitsStep from '@/pages/setup/flow/steps/BenefitsStep';
import MaritalFilingStep from '@/pages/setup/flow/steps/MaritalFilingStep';
import StateCityStep from '@/pages/setup/flow/steps/StateCityStep';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { markSetupDismissed } from '@/lib/setup-dismissal';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { makeHousehold, makePerson } from '../../../factories';

/**
 * M5 (D-W4): Settings → Revisit setup opens the flow post-finish with the
 * progress record CLEARED (asked=false everywhere) but real saved cells.
 * Person-backed steps prefill whenever a bound person exists; household-
 * backed steps prefill once setup was finished (isSetupDismissed) — the
 * pre-seeded-row hazard only exists pre-first-finish.
 */

const ALEX = makePerson({
  id: 1, name: 'Alex Rivera', dateOfBirth: '1990-05-01',
  employmentType: 'SALARY_NO_OT', annualSalaryPretax: 95000,
  targetRetirementAge: 67, pretax401kPct: 0.06,
  hsaEligible: true, hsaMonthlyContribution: 0,
});

function revisitCtx(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold({ filingStatus: 'SINGLE', state: 'NY' }),
    persons: [ALEX], dependents: [], accounts: [], properties: [], housingPayments: [],
    vehicles: [], vehicleLeases: [], equityGrants: [], loans: [], transactions: [], goals: [],
    progress: defaultProgressV2(), // cleared by Finish — nothing is "asked"
    todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(
  Step: typeof PayStep,
  ctx: FlowCtx,
  role: 'you' | 'partner' = 'you',
) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <Step ctx={ctx} role={role} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />,
  );
  return { submitRef };
}

beforeEach(() => {
  localStorage.clear();
  markSetupDismissed(); // the revisit precondition — setup was finished once
  const base = { isLoading: false, error: null, load: async () => {} };
  useHouseholdStore.setState({
    household: makeHousehold({ filingStatus: 'SINGLE', state: 'NY' }),
    update: async () => {}, ...base,
  } as never);
  usePersonsStore.setState({
    persons: [ALEX], update: async () => {}, create: async () => 1, ...base,
  } as never);
  useTaxRulesStore.setState({
    items: [], year: null, isLoading: false, error: null, loadYear: async () => {},
  } as never);
});

describe('M5: Revisit setup renders prefilled steps (D-W4)', () => {
  it('PayStep prefills from the bound person without an asked flag', () => {
    renderStep(PayStep, revisitCtx());
    expect(screen.getByRole('radio', { name: 'Salary', exact: true })).toBeChecked();
    expect(screen.getByLabelText('Annual salary (pre-tax)')).toHaveValue(95000);
  });

  it('RetirementStep prefills the bound person’s age', () => {
    renderStep(RetirementStep, revisitCtx());
    expect(screen.getByLabelText('Target retirement age')).toHaveValue(67);
  });

  it('BenefitsStep prefills the 401(k) percent from the bound person', () => {
    renderStep(BenefitsStep, revisitCtx());
    expect(screen.getByLabelText(/401\(k\)/)).toHaveValue(6);
  });

  it('m4: a zero stored contribution never preselects the HSA question as Yes', () => {
    // hsaEligible true but contribution 0 (e.g. after an explicit-No save
    // wrote the honest zero) — the control must render unanswered, not Yes.
    renderStep(BenefitsStep, revisitCtx());
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('MaritalFilingStep prefills the filing status once setup was finished', () => {
    renderStep(MaritalFilingStep, revisitCtx());
    // SINGLE household prefills the no-branch with Single selected.
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked();
  });

  it('StateCityStep prefills the state once setup was finished', () => {
    renderStep(StateCityStep, revisitCtx());
    expect(screen.getByLabelText('Which state do you live in?')).toHaveValue('NY');
  });
});
