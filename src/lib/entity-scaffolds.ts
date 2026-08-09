import type { Account, Person } from '@/types/schema';
import { AccountType } from '@/types/enums';

/**
 * Component-free entity scaffolds (worded-onboarding Persistence rule 2):
 * the deferred one-shot person create composes real answers over these
 * defaults; domain/setup-flow must never import from @/components. The
 * canonical forms re-export these — one copy, forever.
 */

// PersonScaffoldValues mirrors Person but drops the DB-only id and the
// roadmap rule-engine chart-answer columns (those are written by
// roadmap decision nodes, not by the person edit form).
export type PersonScaffoldValues = Omit<
  Person,
  | 'id'
  | 'jobStability'
  | 'expectsHigherFutureIncome'
  | 'onParentHealthInsurance'
  | 'isRelativelyHealthy'
>;

export const DEFAULT_PERSON: PersonScaffoldValues = {
  householdId: 1,
  name: '',
  dateOfBirth: '',
  targetRetirementAge: 65,
  annualSalaryPretax: 0,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: null,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
  monthlyExpenseBaseline: null,
};

// Strip only the roadmap chart-answer column written by other surfaces
// (hasHighFees) and id. The 401(k) plan-benefit flags ARE written by the
// canonical AccountForm.
export type AccountScaffoldValues = Omit<Account, 'id' | 'hasHighFees'>;

export const DEFAULT_ACCOUNT: AccountScaffoldValues = {
  householdId: 1,
  ownerPersonId: null,
  beneficiaryDependentId: null,
  name: '',
  institution: null,
  type: AccountType.ACCOUNT_BROKERAGE,
  cryptoWalletAddress: null,
  autoFetchEnabled: false,
  excludedFromNetWorth: false,
  allowMargin: false,
  stateOfPlan: null,
  accentColor: null,
  apyRate: null,
  hasEmployerMatch: null,
  employerMatchPct: null,
  employerMatchLimitPct: null,
  allowsMegaBackdoorRollover: null,
};
