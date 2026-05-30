import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import { usePersonsStore } from '@/stores/persons-store';

/**
 * Section 4 stragglers — the IRA top + future-income decision + solo
 * 401(k) reference info node. iraBranch.ts already owns the band rule
 * and the three contribution actions; this file fills in the rest.
 */

// ──────────────────────────────────────────────────────────────────
// s4_earned_income_q — chart routes around the entire IRA chain if no.
// ──────────────────────────────────────────────────────────────────
export function evaluateEarnedIncomeQ(ctx: RoadmapContext): NodeResult {
  if (ctx.persons.length === 0) {
    return {
      status: 'info',
      evidence: 'Add a Person to declare earned income before the IRA chain applies.',
      cta: { label: 'Open Household →', href: '/household' },
    };
  }
  const anyEarned = ctx.persons.some((p) => (p.annualSalaryPretax ?? 0) > 0);
  if (anyEarned) {
    return { status: 'done', evidence: 'At least one household member has earned income — IRA contributions are open.' };
  }
  return {
    status: 'info',
    evidence: 'No earned income on file — IRAs require earned income, so the chart routes around this section.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s4_contribute_ira — informational; the band rule + actions do real work.
// ──────────────────────────────────────────────────────────────────
export function evaluateContributeIra(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Calculate your MAGI below to see which IRA path applies.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s4_expect_higher_income_q — answer drives s4_traditional_ira branch.
// ──────────────────────────────────────────────────────────────────
export function evaluateExpectHigherIncomeQ(ctx: RoadmapContext): NodeResult {
  if (ctx.persons.length === 0) {
    return { status: 'info', evidence: 'Add a Person first.' };
  }
  const unanswered = ctx.persons.find((p) => p.expectsHigherFutureIncome === null);
  if (unanswered) {
    const personId = unanswered.id ?? 0;
    return {
      status: 'unanswered',
      evidence: `Will ${unanswered.name}'s future income exceed the IRS Roth threshold?`,
      question: {
        prompt: `Do you expect ${unanswered.name}'s future income to exceed the IRS Roth threshold?`,
        answerType: 'yes-no',
        onAnswer: async (value) => {
          await usePersonsStore.getState().update(personId, {
            expectsHigherFutureIncome: value === 'yes',
          });
        },
      },
    };
  }
  const anyHigher = ctx.persons.some((p) => p.expectsHigherFutureIncome === true);
  if (anyHigher) {
    return { status: 'done', evidence: 'Higher future income expected → prefer Roth to avoid future pro-rata pain.' };
  }
  return { status: 'done', evidence: 'No higher future income expected → traditional IRA deduction is available.' };
}

// ──────────────────────────────────────────────────────────────────
// s4_solo_401k — info reminder, only relevant on the traditional branch.
// ──────────────────────────────────────────────────────────────────
export function evaluateSolo401k(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'If you go traditional, opening a solo-401(k) and rolling the tIRA in sidesteps future pro-rata.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_mega_backdoor / s6_after_tax_401k_q — account hint
// ──────────────────────────────────────────────────────────────────
export function evaluateAfterTax401kQ(ctx: RoadmapContext): NodeResult {
  const accts = ctx.accounts.filter(
    (a) => a.type === AccountType.ACCOUNT_401K || a.type === AccountType.ACCOUNT_ROTH_401K,
  );
  if (accts.length === 0) {
    return { status: 'info', evidence: 'No 401(k) on file — add one in Accounts to evaluate the mega backdoor.' };
  }
  const allows = accts.some((a) => a.allowsMegaBackdoorRollover === true);
  const anyUnanswered = accts.some((a) => a.allowsMegaBackdoorRollover === null);
  if (allows) {
    return { status: 'done', evidence: 'At least one 401(k) allows after-tax + in-plan Roth rollover.' };
  }
  if (anyUnanswered) {
    return {
      status: 'unanswered',
      evidence: 'Check your 401(k) plan documents and mark whether after-tax + in-plan Roth rollover is allowed.',
      cta: { label: 'Open Accounts →', href: '/accounts' },
    };
  }
  return { status: 'info', evidence: 'No 401(k) allows the mega backdoor — that path is closed for you.' };
}

export function evaluateMegaBackdoor(ctx: RoadmapContext): NodeResult {
  const accts = ctx.accounts.filter(
    (a) => a.type === AccountType.ACCOUNT_401K || a.type === AccountType.ACCOUNT_ROTH_401K,
  );
  if (accts.some((a) => a.allowsMegaBackdoorRollover === true)) {
    return {
      status: 'active',
      evidence: 'Mega backdoor is available — max after-tax contributions and roll into Roth up to the $66k combined limit.',
      cta: { label: 'Open Contributions →', href: '/contributions' },
    };
  }
  return { status: 'skipped', evidence: 'Mega backdoor is not available based on your accounts.' };
}
