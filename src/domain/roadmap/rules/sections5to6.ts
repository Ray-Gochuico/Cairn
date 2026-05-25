import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import { useHouseholdStore } from '@/stores/household-store';

/**
 * Sections 5 & 6 — Additional Savings + After-Tax & Taxable.
 *
 * These nodes lean heavily on chart guidance rather than computed
 * state. A handful read a household answer (charitable gifts, large
 * purchases) or an account flag (ESPP, after-tax 401(k)). The rest
 * are info-only because the app can't observe them (wash-sale rules,
 * IPS-driven rebalancing cadence, etc.).
 *
 * The decision rules write through useHouseholdStore.update().
 */

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ──────────────────────────────────────────────────────────────────
// s5_espp_q / s5_espp_action
// We don't track ESPP availability per-account today — surface as info
// with chart guidance and a CTA to the docs/accounts page.
// ──────────────────────────────────────────────────────────────────
export function evaluateEsppQ(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Check whether your employer offers an Employee Stock Purchase Plan (ESPP).',
  };
}

export function evaluateEsppAction(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'If ESPP: buy at the discounted price, sell immediately, redirect proceeds back into your plan.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s5_large_purchases_q
// ──────────────────────────────────────────────────────────────────
export function evaluateLargePurchasesQ(ctx: RoadmapContext): NodeResult {
  const v = ctx.household.upcomingLargePurchase;
  if (v === true) {
    const amt = ctx.household.upcomingPurchaseAmount;
    const months = ctx.household.upcomingPurchaseMonths;
    const detail = amt != null && months != null
      ? ` (${formatUSD(amt)} in ${months} months)`
      : '';
    return { status: 'done', evidence: `Upcoming large purchase planned${detail}.` };
  }
  if (v === false) {
    return { status: 'info', evidence: 'No upcoming large purchases — skip ahead.' };
  }
  return {
    status: 'unanswered',
    evidence: 'Any large required purchases in the next 3–5 years?',
    question: {
      prompt: 'Any large required purchases (house, car, tuition, etc.) in the next 3–5 years?',
      answerType: 'yes-no',
      onAnswer: async (value) => {
        await useHouseholdStore.getState().update({ upcomingLargePurchase: value === 'yes' });
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// s5_save_short_term
// ──────────────────────────────────────────────────────────────────
export function evaluateSaveShortTerm(ctx: RoadmapContext): NodeResult {
  if (ctx.household.upcomingLargePurchase === true) {
    return {
      status: 'active',
      evidence: 'Park the upcoming-purchase amount in HYSA / 529 / ESA depending on whether it is educational.',
      cta: { label: 'Open Accounts →', href: '/accounts' },
    };
  }
  return { status: 'skipped', evidence: 'No upcoming large purchase — skipped.' };
}

// ──────────────────────────────────────────────────────────────────
// s5_employment_type_q / s5_max_401k
// ──────────────────────────────────────────────────────────────────
export function evaluateEmploymentTypeQ(ctx: RoadmapContext): NodeResult {
  if (ctx.persons.length === 0) {
    return { status: 'info', evidence: 'Add a Person to record W-2 vs self-employed.' };
  }
  // We don't model self-employed explicitly yet; treat presence of
  // salary as W-2 (the common case) and surface a hint for self-
  // employed users to use the override.
  const allHaveSalary = ctx.persons.every((p) => (p.annualSalaryPretax ?? 0) > 0);
  if (allHaveSalary) {
    return { status: 'done', evidence: 'W-2 income detected — finish maxing your employer 401(k).' };
  }
  return {
    status: 'info',
    evidence: 'No salary on file. If self-employed, evaluate maxing a solo-401(k); override this node accordingly.',
  };
}

export function evaluateMax401k(ctx: RoadmapContext): NodeResult {
  const has401k = ctx.accounts.some((a) => a.type === AccountType.ACCOUNT_401K);
  if (!has401k) {
    return {
      status: 'info',
      evidence: 'No 401(k) on file — add one to track progress toward maxing it.',
      cta: { label: 'Open Accounts →', href: '/accounts' },
    };
  }
  return {
    status: 'info',
    evidence: 'Finish maxing the employer plan (or solo-401(k) if self-employed). The $23k limit is your target.',
    cta: { label: 'Open Contributions →', href: '/contributions' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s5_prioritize_ira_vs_401k — info reference
// ──────────────────────────────────────────────────────────────────
export function evaluatePrioritizeIraVs401k(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Capture the match first. IRAs add flexibility; 401(k)s reduce MAGI; 457(b)s avoid the 10% early-withdrawal penalty.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_529_action
// ──────────────────────────────────────────────────────────────────
export function evaluate529(ctx: RoadmapContext): NodeResult {
  const has529 = ctx.accounts.some((a) => a.type === AccountType.ACCOUNT_529);
  if (has529) {
    return { status: 'done', evidence: 'A 529 is on file — verify state-tax deduction eligibility.' };
  }
  return {
    status: 'info',
    evidence: 'No 529 on file. Worth evaluating if you plan to fund education for future generations.',
    cta: { label: 'Open Accounts →', href: '/accounts' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_taxable_brokerage
// ──────────────────────────────────────────────────────────────────
export function evaluateTaxableBrokerage(ctx: RoadmapContext): NodeResult {
  const hasBrokerage = ctx.accounts.some((a) => a.type === AccountType.ACCOUNT_BROKERAGE);
  if (hasBrokerage) {
    return { status: 'done', evidence: 'Taxable brokerage on file — keep contributing if cashflow permits.' };
  }
  return {
    status: 'info',
    evidence: 'No taxable brokerage on file — useful for flexibility once the tax-advantaged buckets are maxed.',
    cta: { label: 'Open Accounts →', href: '/accounts' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_tax_loss_harvest — info (we don't analyze lots yet)
// ──────────────────────────────────────────────────────────────────
export function evaluateTaxLossHarvest(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Watch the wash-sale rule (30 days across all your accounts, including IRAs).',
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_charitable_daf
// ──────────────────────────────────────────────────────────────────
export function evaluateCharitableDaf(ctx: RoadmapContext): NodeResult {
  const v = ctx.household.makesCharitableGifts;
  if (v === true) {
    return { status: 'active', evidence: 'You make charitable gifts — a DAF can front-load multiple years of deductions.' };
  }
  if (v === false) {
    return { status: 'skipped', evidence: 'No charitable giving on file — DAF skipped.' };
  }
  return {
    status: 'unanswered',
    evidence: 'Do you make regular charitable gifts?',
    question: {
      prompt: 'Do you make regular charitable gifts?',
      answerType: 'yes-no',
      onAnswer: async (value) => {
        await useHouseholdStore.getState().update({ makesCharitableGifts: value === 'yes' });
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// s6_rebalance — info reference
// ──────────────────────────────────────────────────────────────────
export function evaluateRebalance(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Rebalance to your IPS regularly. Prefer rebalancing via new contributions to avoid taxable events.',
  };
}
