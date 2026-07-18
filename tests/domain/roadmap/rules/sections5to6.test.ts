import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateEsppQ,
  evaluateEsppAction,
  evaluateLargePurchasesQ,
  evaluateSaveShortTerm,
  evaluateEmploymentTypeQ,
  evaluateMax401k,
  evaluatePrioritizeIraVs401k,
  evaluate529,
  evaluateTaxableBrokerage,
  evaluateTaxLossHarvest,
  evaluateCharitableDaf,
  evaluateRebalance,
} from '@/domain/roadmap/rules/sections5to6';
import {
  evaluateEarnedIncomeQ,
  evaluateContributeIra,
  evaluateExpectHigherIncomeQ,
  evaluateSolo401k,
  evaluateAfterTax401kQ,
  evaluateMegaBackdoor,
} from '@/domain/roadmap/rules/section4Misc';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import type { Account, Person } from '@/types/schema';
import type { RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import { makeHousehold } from '../../../factories';


function makePerson(patch: Partial<Person> = {}): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'Alex',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100_000,
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
    jobStability: null,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
    ...patch,
  };
}

function makeAccount(id: number, type: AccountType, patch: Partial<Account> = {}): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: 1,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    ...patch,
  };
}

function makeContext(patch: Partial<RoadmapContext> = {}): RoadmapContext {
  return {
    household: makeHousehold(),
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T00:00:00Z'),
    ...patch,
  };
}

describe('Section 4 stragglers', () => {
  describe('evaluateEarnedIncomeQ', () => {
    it('info when no persons', () => {
      expect(evaluateEarnedIncomeQ(makeContext()).status).toBe('info');
    });
    it('done when any person has salary > 0', () => {
      expect(
        evaluateEarnedIncomeQ(makeContext({ persons: [makePerson({ annualSalaryPretax: 100_000 })] })).status,
      ).toBe('done');
    });
    it('info when all persons have zero salary', () => {
      expect(
        evaluateEarnedIncomeQ(makeContext({ persons: [makePerson({ annualSalaryPretax: 0 })] })).status,
      ).toBe('info');
    });
  });

  describe('evaluateContributeIra', () => {
    it('returns info', () => {
      expect(evaluateContributeIra(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateExpectHigherIncomeQ', () => {
    beforeEach(() => {
      usePersonsStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
    });
    it('info when no persons', () => {
      expect(evaluateExpectHigherIncomeQ(makeContext()).status).toBe('info');
    });
    it('unanswered with question when any person has null', () => {
      const r = evaluateExpectHigherIncomeQ(makeContext({ persons: [makePerson({ expectsHigherFutureIncome: null })] }));
      expect(r.status).toBe('unanswered');
      expect(r.question?.answerType).toBe('yes-no');
    });
    it('done with higher-income branch when any yes', () => {
      const r = evaluateExpectHigherIncomeQ(makeContext({ persons: [makePerson({ expectsHigherFutureIncome: true })] }));
      expect(r.status).toBe('done');
      expect(r.evidence).toMatch(/Roth/);
    });
    it('done with lower-income branch when all no', () => {
      const r = evaluateExpectHigherIncomeQ(makeContext({ persons: [makePerson({ expectsHigherFutureIncome: false })] }));
      expect(r.status).toBe('done');
      expect(r.evidence).toMatch(/traditional/);
    });
    it('writes through the persons store on answer', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      usePersonsStore.setState({ update } as any);
      const r = evaluateExpectHigherIncomeQ(makeContext({ persons: [makePerson({ id: 3 })] }));
      await r.question!.onAnswer('yes');
      expect(update).toHaveBeenCalledWith(3, { expectsHigherFutureIncome: true });
    });
  });

  describe('evaluateSolo401k', () => {
    it('returns info', () => {
      expect(evaluateSolo401k(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateAfterTax401kQ', () => {
    it('info without a 401(k)', () => {
      expect(evaluateAfterTax401kQ(makeContext()).status).toBe('info');
    });
    it('done when at least one allows mega backdoor', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: true })];
      expect(evaluateAfterTax401kQ(makeContext({ accounts: accts })).status).toBe('done');
    });
    it('unanswered when any 401(k) flag is null', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: null })];
      expect(evaluateAfterTax401kQ(makeContext({ accounts: accts })).status).toBe('unanswered');
    });
    it('info when all 401(k)s answered false', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: false })];
      expect(evaluateAfterTax401kQ(makeContext({ accounts: accts })).status).toBe('info');
    });

    it('asks inline when exactly one 401(k) is unanswered, and writes the flag (W10 M24)', async () => {
      const accts = [makeAccount(9, AccountType.ACCOUNT_401K, { name: 'Acme 401(k)', allowsMegaBackdoorRollover: null })];
      const result = evaluateAfterTax401kQ(makeContext({ accounts: accts }));
      expect(result.status).toBe('unanswered');
      expect(result.question?.prompt).toMatch(/Acme 401\(k\).*mega.backdoor/i);
      const update = vi.fn(async () => {});
      useAccountsStore.setState({ update } as never);
      await result.question!.onAnswer('yes');
      expect(update).toHaveBeenCalledWith(9, { allowsMegaBackdoorRollover: true });
    });

    it('falls back to the Accounts CTA when several 401(k)s are unanswered (W10 M24)', () => {
      const accts = [
        makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: null }),
        makeAccount(2, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: null }),
      ];
      const result = evaluateAfterTax401kQ(makeContext({ accounts: accts }));
      expect(result.question).toBeUndefined();
      expect(result.cta?.href).toBe('/investments?manage=accounts');
    });
  });

  describe('evaluateMegaBackdoor', () => {
    it('active when any 401(k) allows it', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: true })];
      expect(evaluateMegaBackdoor(makeContext({ accounts: accts })).status).toBe('active');
    });
    it('skipped otherwise', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: false })];
      expect(evaluateMegaBackdoor(makeContext({ accounts: accts })).status).toBe('skipped');
    });
    it('cites the interpolated 2026 §415(c) combined limit, year-anchored, not the stale $66k', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { allowsMegaBackdoorRollover: true })];
      const r = evaluateMegaBackdoor(makeContext({ accounts: accts }));
      expect(r.evidence).toMatch(/\$72,000 .*2026/);
      expect(r.evidence).not.toContain('$66k');
    });
  });
});

describe('Section 5/6 rules', () => {
  describe('evaluateEsppQ + evaluateEsppAction', () => {
    it('return info', () => {
      expect(evaluateEsppQ(makeContext()).status).toBe('info');
      expect(evaluateEsppAction(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateLargePurchasesQ', () => {
    beforeEach(() => {
      useHouseholdStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
    });
    it('unanswered when null', () => {
      expect(evaluateLargePurchasesQ(makeContext()).status).toBe('unanswered');
    });
    it('done with amount + months when set', () => {
      const r = evaluateLargePurchasesQ(
        makeContext({
          household: makeHousehold({
            upcomingLargePurchase: true,
            upcomingPurchaseAmount: 30_000,
            upcomingPurchaseMonths: 12,
          }),
        }),
      );
      expect(r.status).toBe('done');
      expect(r.evidence).toMatch(/\$30,000/);
      expect(r.evidence).toMatch(/12 months/);
    });
    it('info when false', () => {
      expect(
        evaluateLargePurchasesQ(makeContext({ household: makeHousehold({ upcomingLargePurchase: false }) })).status,
      ).toBe('info');
    });
    it('writes through the household store', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      useHouseholdStore.setState({ update } as any);
      const r = evaluateLargePurchasesQ(makeContext());
      await r.question!.onAnswer('yes');
      expect(update).toHaveBeenCalledWith({ upcomingLargePurchase: true });
    });
  });

  describe('evaluateSaveShortTerm', () => {
    it('active when upcomingLargePurchase=true', () => {
      expect(
        evaluateSaveShortTerm(makeContext({ household: makeHousehold({ upcomingLargePurchase: true }) })).status,
      ).toBe('active');
    });
    it('skipped otherwise', () => {
      expect(evaluateSaveShortTerm(makeContext()).status).toBe('skipped');
    });
  });

  describe('evaluateEmploymentTypeQ', () => {
    it('info when no persons', () => {
      expect(evaluateEmploymentTypeQ(makeContext()).status).toBe('info');
    });
    it('done when everyone has salary', () => {
      expect(
        evaluateEmploymentTypeQ(makeContext({ persons: [makePerson({ annualSalaryPretax: 100_000 })] })).status,
      ).toBe('done');
    });
    it('info when any zero salary (hints at self-employment)', () => {
      expect(
        evaluateEmploymentTypeQ(makeContext({ persons: [makePerson({ annualSalaryPretax: 0 })] })).status,
      ).toBe('info');
    });
  });

  describe('evaluateMax401k', () => {
    it('info without a 401(k)', () => {
      expect(evaluateMax401k(makeContext()).status).toBe('info');
    });
    it('info with a 401(k) (chart guidance, not auto-tracked)', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K)];
      expect(evaluateMax401k(makeContext({ accounts: accts })).status).toBe('info');
    });
    it('cites the interpolated 2026 deferral limit, year-anchored, not the stale $23k', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_401K)];
      const r = evaluateMax401k(makeContext({ accounts: accts }));
      expect(r.evidence).toMatch(/\$24,500 .*2026/);
      expect(r.evidence).not.toContain('$23k');
    });
  });

  describe('evaluatePrioritizeIraVs401k', () => {
    it('returns info', () => {
      expect(evaluatePrioritizeIraVs401k(makeContext()).status).toBe('info');
    });
  });

  describe('evaluate529', () => {
    it('done with a 529 on file', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_529)];
      expect(evaluate529(makeContext({ accounts: accts })).status).toBe('done');
    });
    it('info without one', () => {
      expect(evaluate529(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateTaxableBrokerage', () => {
    it('done with brokerage on file', () => {
      const accts = [makeAccount(1, AccountType.ACCOUNT_BROKERAGE)];
      expect(evaluateTaxableBrokerage(makeContext({ accounts: accts })).status).toBe('done');
    });
    it('info without one', () => {
      expect(evaluateTaxableBrokerage(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateTaxLossHarvest + evaluateRebalance', () => {
    it('return info', () => {
      expect(evaluateTaxLossHarvest(makeContext()).status).toBe('info');
      expect(evaluateRebalance(makeContext()).status).toBe('info');
    });
  });

  describe('evaluateCharitableDaf', () => {
    beforeEach(() => {
      useHouseholdStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
    });
    it('unanswered when null', () => {
      expect(evaluateCharitableDaf(makeContext()).status).toBe('unanswered');
    });
    it('active when true', () => {
      expect(
        evaluateCharitableDaf(makeContext({ household: makeHousehold({ makesCharitableGifts: true }) })).status,
      ).toBe('active');
    });
    it('skipped when false', () => {
      expect(
        evaluateCharitableDaf(makeContext({ household: makeHousehold({ makesCharitableGifts: false }) })).status,
      ).toBe('skipped');
    });
    it('writes through the household store', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      useHouseholdStore.setState({ update } as any);
      const r = evaluateCharitableDaf(makeContext());
      await r.question!.onAnswer('yes');
      expect(update).toHaveBeenCalledWith({ makesCharitableGifts: true });
    });
  });
});
