import type { ComponentType } from 'react';
import type { StepId } from '@/lib/setup-progress';
import type { GateStepId } from '@/domain/setup-flow/engine';
import type { StepComponentProps } from './step-props';
import AboutYouStep from './steps/AboutYouStep';
import MaritalFilingStep from './steps/MaritalFilingStep';
import StateCityStep from './steps/StateCityStep';
import ExpensesStep from './steps/ExpensesStep';
import DependentsGateStep from './steps/DependentsGateStep';
import PayStep from './steps/PayStep';
import RetirementStep from './steps/RetirementStep';
import BenefitsStep from './steps/BenefitsStep';
import AccountsGateStep from './steps/AccountsGateStep';
import HomeGateStep from './steps/HomeGateStep';
import RentGateStep from './steps/RentGateStep';
import VehiclesGateStep from './steps/VehiclesGateStep';
import EquityGateStep from './steps/EquityGateStep';
import LoansGateStep from './steps/LoansGateStep';
import ImportGateStep from './steps/ImportGateStep';
import GoalsGateStep from './steps/GoalsGateStep';

export interface GateCopy {
  question: string;
  consequence: string;
  nounSingular: string;
  nounPlural: string;
  /** CW-34 import-gate variant; the standard template otherwise. */
  changedYourMindText?: string;
}

/** CW-30/31/33/34 config for every gate (single source for gate copy slots). */
export const GATE_CONFIG: Record<GateStepId, GateCopy> = {
  dependents_gate: {
    question: 'Do you have children or other dependents?',
    consequence: 'Nothing is recorded — dependents can be added any time under Inputs → Dependents.',
    nounSingular: 'dependent', nounPlural: 'dependents',
  },
  accounts_gate: {
    question: 'Do you have any financial accounts — checking, savings, retirement, brokerage?',
    consequence: 'Nothing is recorded — accounts can be added any time on the Investments page.',
    nounSingular: 'account', nounPlural: 'accounts',
  },
  home_gate: {
    question: 'Do you own your home?',
    consequence: 'Nothing is recorded — property can be added any time on the Property page.',
    nounSingular: 'property', nounPlural: 'properties',
  },
  rent_gate: {
    question: 'Do you pay rent?',
    consequence: 'Nothing is recorded — housing payments can be added any time on the Property page.',
    nounSingular: 'housing payment', nounPlural: 'housing payments',
  },
  vehicles_gate: {
    question: 'Do you own any vehicles?',
    consequence: 'Nothing is recorded — vehicles can be added any time on the Vehicles page.',
    nounSingular: 'vehicle or lease', nounPlural: 'vehicles or leases',
  },
  equity_gate: {
    question: 'Does your employer give you stock — RSUs or options?',
    consequence: 'Nothing is recorded — equity grants can be added any time on the Equity grants page.',
    nounSingular: 'equity grant', nounPlural: 'equity grants',
  },
  loans_gate: {
    question: 'Do you have any loans — mortgage, car, student, credit cards?',
    consequence: 'Nothing is recorded — loans can be added any time on the Loans page.',
    nounSingular: 'loan', nounPlural: 'loans',
  },
  import_gate: {
    question: 'Want to import bank transactions now?',
    consequence: 'You can always do this later on the Spending page.',
    nounSingular: 'imported transaction', nounPlural: 'imported transactions',
    changedYourMindText: 'You said not now earlier — changed your mind?',
  },
  goals_gate: {
    question: 'Any savings goals to track?',
    consequence: 'Nothing is recorded — goals can be added any time on the Goals page.',
    nounSingular: 'goal', nounPlural: 'goals',
  },
};

/** Steps with an explicit skip control (CW-7) + its consequence line. */
export const SKIPPABLE: Partial<Record<StepId, { label: string; consequence: string }>> = {
  expenses: {
    label: 'Skip this question',
    consequence: 'Skip and those stay empty until you set it in Household.',
  },
  benefits: {
    label: 'Skip these',
    consequence:
      "Skip and {name}'s 401(k), HSA, and premium entries stay at zero until you set them under Inputs → People.",
  },
};

export const STEP_COMPONENTS: Record<StepId, ComponentType<StepComponentProps>> = {
  about_you: AboutYouStep,
  marital_filing: MaritalFilingStep,
  state_city: StateCityStep,
  dependents_gate: DependentsGateStep,
  expenses: ExpensesStep,
  pay: PayStep,
  retirement: RetirementStep,
  benefits: BenefitsStep,
  accounts_gate: AccountsGateStep,
  home_gate: HomeGateStep,
  rent_gate: RentGateStep,
  vehicles_gate: VehiclesGateStep,
  equity_gate: EquityGateStep,
  loans_gate: LoansGateStep,
  import_gate: ImportGateStep,
  goals_gate: GoalsGateStep,
};
