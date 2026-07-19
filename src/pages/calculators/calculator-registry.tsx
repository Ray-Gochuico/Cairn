import type { ComponentType } from 'react';
import type { Person } from '@/types/schema';
import {
  CALCULATOR_CARD_DEFS,
  type CalculatorCardDef,
} from '@/lib/calculator-card-layout';
import { PaycheckCard } from './PaycheckCard';
import { BonusTaxCard } from './BonusTaxCard';
import { CommissionTaxCard } from './CommissionTaxCard';
import { OvertimeCard } from './OvertimeCard';
import { Retirement401kWithdrawalCard } from './Retirement401kWithdrawalCard';
import { FinancialIndependenceCard } from './FinancialIndependenceCard';
import { CoastFiCard } from './CoastFiCard';
import { CompoundInterestCard } from './CompoundInterestCard';
import { BacktestCard } from './BacktestCard';
import { DebtPayoffCard } from './DebtPayoffCard';
import { EquityValueCard } from './EquityValueCard';
import { ContributionAllocatorCard } from './ContributionAllocatorCard';

export interface CalculatorAvailabilityCtx {
  persons: Person[];
}

// Wave 18 B6 TRANSITIONAL (removed by Tasks 7–8): the merged ids gate BOTH
// predecessors, mounted adjacently under the merged cardId, so this commit
// changes IDS ONLY — any hidden-state regression bisects to here, isolated
// from the card rewrites. The duplicated panel/testid DOM ids this creates
// are accepted for exactly this one commit.
function SupplementalPayTransitional({ cardId }: { cardId?: string }) {
  return (
    <>
      <BonusTaxCard cardId={cardId} />
      <CommissionTaxCard cardId={cardId} />
    </>
  );
}

function PathToFiTransitional({ cardId }: { cardId?: string }) {
  return (
    <>
      <FinancialIndependenceCard cardId={cardId} />
      <CoastFiCard cardId={cardId} />
    </>
  );
}

export interface CalculatorCardRegistration extends CalculatorCardDef {
  Component: ComponentType<{ cardId?: string }>;
  /** Absent = always available. Present = render + Customize row gate. */
  isAvailable?: (ctx: CalculatorAvailabilityCtx) => boolean;
  /** Shown (muted) under the disabled Customize row when unavailable. */
  unavailableReason?: string;
}

type Registration = Omit<CalculatorCardRegistration, keyof CalculatorCardDef>;

// Keyed by id; the export below zips with CALCULATOR_CARD_DEFS so ORDER,
// LABEL, and GROUP have exactly one source. The registry test asserts every
// def has an entry here — adding a card without registering it fails CI.
const REGISTRATIONS: Record<string, Registration> = {
  'paycheck': { Component: PaycheckCard },
  'supplemental-pay': { Component: SupplementalPayTransitional },
  'overtime': {
    Component: OvertimeCard,
    // W10: without an hourly/OT person the card can never render — the
    // Customize row disables with this reason instead of no-opping.
    isAvailable: ({ persons }) =>
      persons.some((p) => p.employmentType === 'HOURLY' || p.employmentType === 'SALARY_WITH_OT'),
    unavailableReason: 'Add an hourly or salary+OT person in Inputs to enable this card.',
  },
  'retirement-401k-withdrawal': { Component: Retirement401kWithdrawalCard },
  'path-to-fi': { Component: PathToFiTransitional },
  'compound-interest': { Component: CompoundInterestCard },
  'backtest': { Component: BacktestCard },
  'debt-payoff': { Component: DebtPayoffCard },
  'equity': { Component: EquityValueCard },
  'contribution-allocator': { Component: ContributionAllocatorCard },
};

export const CALCULATOR_CARDS: readonly CalculatorCardRegistration[] =
  CALCULATOR_CARD_DEFS.map((def) => ({ ...def, ...REGISTRATIONS[def.id] }));
