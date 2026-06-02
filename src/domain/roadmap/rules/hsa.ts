import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';

/**
 * Section 3 — HSA chain.
 *
 * The chart's HSA section branches early:
 *   s3_pick_medical_insurance     → info (chart guidance)
 *   s3_hdhp_q                     → decision: household.hasHsaQualifiedHdhp
 *   s3_contribute_hsa             → action: HSA account exists + YTD>0
 *   s3_save_receipts              → info (no way to verify)
 *   s3_hsa_fees_q                 → decision: per-account hasHighFees
 *   s3_rollover_hsa               → action (active when fees flagged)
 *   s3_keep_employer_hsa          → info (active when fees=false)
 *
 * The branch shape mirrors emergencyFund's stable/unstable split: one
 * decision answer turns on one path's rule and turns off the other.
 */

function findHsa(accounts: Account[]): Account | undefined {
  return accounts.find((a) => a.type === AccountType.ACCOUNT_HSA);
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ──────────────────────────────────────────────────────────────────
// s3_pick_medical_insurance — info
// ──────────────────────────────────────────────────────────────────
export function evaluatePickInsurance(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Compare PPO / POS / HMO / EPO premiums + deductibles. If under 26, compare a parent plan too.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s3_hdhp_q
// ──────────────────────────────────────────────────────────────────
export function evaluateHdhpQ(ctx: RoadmapContext): NodeResult {
  const v = ctx.household.hasHsaQualifiedHdhp;
  if (v === true) {
    return { status: 'done', evidence: 'On an HSA-qualified HDHP — HSA contributions are open to you.' };
  }
  if (v === false) {
    return { status: 'info', evidence: 'No HSA-qualified HDHP — skip ahead to Section 4 (IRAs).' };
  }
  return {
    status: 'unanswered',
    evidence: 'Are you on an HSA-qualified HDHP this year?',
    question: {
      prompt: 'Are you currently on an HSA-qualified HDHP?',
      answerType: 'yes-no',
      onAnswer: async (value) => {
        await useHouseholdStore.getState().update({ hasHsaQualifiedHdhp: value === 'yes' });
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// s3_contribute_hsa
// ──────────────────────────────────────────────────────────────────
export function evaluateContributeHsa(ctx: RoadmapContext): NodeResult {
  if (ctx.household.hasHsaQualifiedHdhp === false) {
    return { status: 'skipped', evidence: 'No HSA-qualified HDHP — HSA contributions are not allowed.' };
  }
  const hsa = findHsa(ctx.accounts);
  if (!hsa || hsa.id == null) {
    return {
      status: 'not-started',
      evidence: 'No HSA on file. Add one in Accounts before contributing.',
      cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
    };
  }
  const year = ctx.today.getFullYear();
  const yearPrefix = `${year}-`;
  const ytd = ctx.contributions
    .filter((c) => c.accountId === hsa.id)
    .filter((c) => c.date.startsWith(yearPrefix))
    .reduce((s, c) => s + c.amount, 0);
  if (ytd > 0) {
    return { status: 'done', evidence: `${formatUSD(ytd)} contributed YTD to ${hsa.name}` };
  }
  return {
    status: 'active',
    evidence: `${hsa.name} exists but $0 contributed this year — start funding it.`,
    cta: { label: 'Open Contributions →', href: '/inputs/contributions' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s3_save_receipts — info
// ──────────────────────────────────────────────────────────────────
export function evaluateSaveReceipts(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Keep digital copies of qualified medical receipts — HSAs let you reimburse yourself years later.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s3_hsa_fees_q
// ──────────────────────────────────────────────────────────────────
export function evaluateHsaFeesQ(ctx: RoadmapContext): NodeResult {
  if (ctx.household.hasHsaQualifiedHdhp === false) {
    return { status: 'skipped', evidence: 'No HSA-qualified HDHP — skipped.' };
  }
  const hsa = findHsa(ctx.accounts);
  if (!hsa || hsa.id == null) {
    return { status: 'not-started', evidence: 'Add an HSA first to evaluate its fees.' };
  }
  if (hsa.hasHighFees === true) {
    return { status: 'done', evidence: `${hsa.name} flagged as high-fee — see the rollover step below.` };
  }
  if (hsa.hasHighFees === false) {
    return { status: 'done', evidence: `${hsa.name} has acceptable fees — keep contributing there.` };
  }
  const accountId = hsa.id;
  return {
    status: 'unanswered',
    evidence: `Do ${hsa.name}'s fees look high relative to a low-cost HSA brokerage?`,
    question: {
      prompt: `Does ${hsa.name} have high fees?`,
      answerType: 'yes-no',
      onAnswer: async (value) => {
        await useAccountsStore.getState().update(accountId, { hasHighFees: value === 'yes' });
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// s3_rollover_hsa
// ──────────────────────────────────────────────────────────────────
export function evaluateRolloverHsa(ctx: RoadmapContext): NodeResult {
  if (ctx.household.hasHsaQualifiedHdhp === false) {
    return { status: 'skipped', evidence: 'No HSA-qualified HDHP — skipped.' };
  }
  const hsa = findHsa(ctx.accounts);
  if (!hsa) return { status: 'not-started', evidence: 'No HSA on file.' };
  if (hsa.hasHighFees === true) {
    return {
      status: 'active',
      evidence: `${hsa.name} is high-fee — trustee-to-trustee transfer to a low-fee HSA brokerage.`,
      cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
    };
  }
  return { status: 'skipped', evidence: 'No high-fee HSA flagged — no rollover needed.' };
}

// ──────────────────────────────────────────────────────────────────
// s3_keep_employer_hsa
// ──────────────────────────────────────────────────────────────────
export function evaluateKeepEmployerHsa(ctx: RoadmapContext): NodeResult {
  if (ctx.household.hasHsaQualifiedHdhp === false) {
    return { status: 'skipped', evidence: 'No HSA-qualified HDHP — skipped.' };
  }
  const hsa = findHsa(ctx.accounts);
  if (!hsa) return { status: 'not-started', evidence: 'No HSA on file.' };
  if (hsa.hasHighFees === false) {
    return {
      status: 'info',
      evidence: `Keep contributing to ${hsa.name}; switch new contributions into the investing portion once you hit the cash minimum.`,
    };
  }
  return { status: 'skipped', evidence: 'High-fee HSA path applies — see the rollover step.' };
}
