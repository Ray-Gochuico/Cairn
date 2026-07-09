import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType, ContributionSource } from '@/types/enums';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';

/**
 * Section 1 — Employer Match & Emergency Fund.
 *
 * Five rules in this file:
 *   - evaluateIps          → s1_consider_ips (decision: has the user
 *                            written an Investment Policy Statement?)
 *   - evaluateNonEssentials → s1_evaluate_non_essentials (info)
 *   - evaluateTrackExpenses → s1_track_expenses (done if transactions
 *                             show activity in the last 30 days)
 *   - evaluateEmployerMatchQ → s1_employer_match_q (decision: do you
 *                              have an employer-match-eligible
 *                              retirement account?)
 *   - evaluateEmployerMatch → s1_employer_match (action: are you
 *                             contributing enough to capture the full
 *                             match?)
 *   - evaluateJobStability → s1_job_stability_q (decision: stable or
 *                            unstable income?)
 *
 * Decision rules return a NodeQuestion that writes through the matching
 * store on answer. Tests stub the store so onAnswer is exercised
 * without hitting the database.
 *
 * Match-capture logic: for every account flagged with
 * `hasEmployerMatch === true`, find its owner's salary, multiply by
 * `employerMatchLimitPct` to get the target the user must put in (the
 * "limit" being the % of salary required to maximize the match, not
 * the match itself). Sum YTD PAYCHECK contributions to that account
 * and compare. Match-eligibility unanswered (null) on any account
 * blocks evaluation with `unanswered` instead of a misleading "active".
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isRetirementAccount(type: string): boolean {
  return (
    type === AccountType.ACCOUNT_401K ||
    type === AccountType.ACCOUNT_ROTH_401K ||
    type === AccountType.ACCOUNT_TRAD_IRA ||
    type === AccountType.ACCOUNT_ROTH_IRA
  );
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ──────────────────────────────────────────────────────────────────
// s1_consider_ips
// ──────────────────────────────────────────────────────────────────
export function evaluateIps(ctx: RoadmapContext): NodeResult {
  const v = ctx.household.hasWrittenIps;
  if (v === true) {
    return { status: 'done', evidence: 'You have a written IPS on file' };
  }
  if (v === false) {
    return {
      status: 'info',
      evidence: 'No IPS yet — optional but recommended before market stress hits',
    };
  }
  return {
    status: 'unanswered',
    evidence: 'Have you written an Investment Policy Statement?',
    question: {
      prompt: 'Have you written an Investment Policy Statement (IPS)?',
      answerType: 'yes-no',
      onAnswer: async (value) => {
        await useHouseholdStore.getState().update({ hasWrittenIps: value === 'yes' });
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// s1_evaluate_non_essentials — info only
// ──────────────────────────────────────────────────────────────────
export function evaluateNonEssentials(_ctx: RoadmapContext): NodeResult {
  return {
    status: 'info',
    evidence: 'Look at recurring bills (cable, streaming, subscriptions) and cut where you can.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s1_track_expenses
// ──────────────────────────────────────────────────────────────────
export function evaluateTrackExpenses(ctx: RoadmapContext): NodeResult {
  const cutoff = ctx.today.getTime() - THIRTY_DAYS_MS;
  const recent = ctx.transactions.filter((t) => {
    const d = new Date(`${t.date}T00:00:00Z`).getTime();
    return d >= cutoff;
  });
  if (recent.length > 0) {
    return {
      status: 'done',
      evidence: `${recent.length} transactions in the last 30 days — tracking is active`,
    };
  }
  return {
    status: 'active',
    evidence: 'No transactions imported in the last 30 days — bring in spending data so the engine can see it',
    cta: { label: 'Open Spending →', href: '/spending' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s1_employer_match_q
// ──────────────────────────────────────────────────────────────────
export function evaluateEmployerMatchQ(ctx: RoadmapContext): NodeResult {
  const retirementAccounts = ctx.accounts.filter((a) => isRetirementAccount(a.type));
  if (retirementAccounts.length === 0) {
    return {
      status: 'info',
      evidence: 'No retirement accounts on file — add a 401(k)/IRA in Accounts to evaluate the match.',
      cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
    };
  }
  const anyMatch = retirementAccounts.some((a) => a.hasEmployerMatch === true);
  const anyUnanswered = retirementAccounts.some((a) => a.hasEmployerMatch === null);
  if (anyMatch) {
    return {
      status: 'done',
      evidence: 'At least one retirement account is flagged with an employer match.',
    };
  }
  if (anyUnanswered) {
    const unanswered = retirementAccounts.filter((a) => a.hasEmployerMatch === null);
    // W10 M24: with ONE unanswered plan the yes/no is attributable — ask
    // inline (evaluateIps pattern) instead of dead-ending on a CTA. The
    // match % stays on AccountForm (numbers don't fit yes-no prompts).
    if (unanswered.length === 1) {
      const acct = unanswered[0];
      return {
        status: 'unanswered',
        evidence: `Does ${acct.name} match employee contributions? Check the plan documents.`,
        question: {
          prompt: `Does ${acct.name}'s employer match contributions?`,
          answerType: 'yes-no',
          onAnswer: async (value) => {
            await useAccountsStore.getState().update(acct.id!, { hasEmployerMatch: value === 'yes' });
          },
        },
        cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
      };
    }
    return {
      status: 'unanswered',
      evidence: 'Mark which retirement accounts (if any) come with an employer match.',
      cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
    };
  }
  return {
    status: 'info',
    evidence: 'No employer match available on your retirement accounts.',
  };
}

// ──────────────────────────────────────────────────────────────────
// s1_employer_match
// ──────────────────────────────────────────────────────────────────
export function evaluateEmployerMatch(ctx: RoadmapContext): NodeResult {
  const matchedAccounts = ctx.accounts.filter((a) => a.hasEmployerMatch === true);
  if (matchedAccounts.length === 0) {
    const anyUnanswered = ctx.accounts.some((a) => isRetirementAccount(a.type) && a.hasEmployerMatch === null);
    if (anyUnanswered) {
      return {
        status: 'unanswered',
        evidence: 'Confirm whether each retirement account has an employer match in Accounts.',
        cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
      };
    }
    return {
      status: 'not-started',
      evidence: 'No retirement account flagged with an employer match — nothing to capture.',
    };
  }

  const year = ctx.today.getFullYear();
  const yearPrefix = `${year}-`;
  let totalTarget = 0;
  let totalYtd = 0;
  const breakdown: string[] = [];

  for (const acct of matchedAccounts) {
    if (acct.id == null) continue;
    const owner = ctx.persons.find((p) => p.id === acct.ownerPersonId);
    const salary = owner?.annualSalaryPretax ?? 0;
    const limitPct = acct.employerMatchLimitPct ?? 0;
    if (salary <= 0 || limitPct <= 0) {
      return {
        status: 'unanswered',
        evidence: `Set the salary and match-limit-pct for ${acct.name} before evaluating.`,
        cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
      };
    }
    const target = salary * limitPct;
    const ytd = ctx.contributions
      .filter((c) => c.accountId === acct.id)
      .filter((c) => c.date.startsWith(yearPrefix))
      .filter((c) => c.source === ContributionSource.PAYCHECK || c.source === ContributionSource.MANUAL)
      .reduce((s, c) => s + c.amount, 0);
    totalTarget += target;
    totalYtd += ytd;
    breakdown.push(`${acct.name}: ${formatUSD(ytd)} / ${formatUSD(target)}`);
  }

  if (totalYtd >= totalTarget) {
    return {
      status: 'done',
      evidence: `Full match captured (${formatUSD(totalYtd)} ≥ ${formatUSD(totalTarget)} across ${matchedAccounts.length} account${matchedAccounts.length === 1 ? '' : 's'}).`,
    };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(totalYtd)} / ${formatUSD(totalTarget)} contributed YTD — ${breakdown.join('; ')}`,
    cta: { label: 'Open Contributions →', href: '/inputs/contributions' },
  };
}

// ──────────────────────────────────────────────────────────────────
// s1_job_stability_q
// ──────────────────────────────────────────────────────────────────
export function evaluateJobStability(ctx: RoadmapContext): NodeResult {
  if (ctx.persons.length === 0) {
    return {
      status: 'info',
      evidence: 'Add a Person to record job-stability for emergency-fund sizing.',
      cta: { label: 'Open Household →', href: '/inputs/household' },
    };
  }
  const unanswered = ctx.persons.find((p) => p.jobStability == null);
  if (unanswered) {
    const personId = unanswered.id ?? 0;
    return {
      status: 'unanswered',
      evidence: `Answer the job-stability question for ${unanswered.name}.`,
      question: {
        prompt: `Is ${unanswered.name}'s job stable or unstable?`,
        answerType: 'enum',
        options: [
          { value: 'stable', label: 'Stable' },
          { value: 'unstable', label: 'Unstable' },
        ],
        onAnswer: async (value) => {
          await usePersonsStore.getState().update(personId, {
            jobStability: value as 'stable' | 'unstable',
          });
        },
      },
    };
  }
  const anyUnstable = ctx.persons.some((p) => p.jobStability === 'unstable');
  if (anyUnstable) {
    return {
      status: 'done',
      evidence: 'At least one household member has unstable income — using the 6–12-month EF target.',
    };
  }
  return {
    status: 'done',
    evidence: 'Stable income across the household — using the 3-month EF target.',
  };
}
