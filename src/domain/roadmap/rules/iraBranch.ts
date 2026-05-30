import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import { TAX_YEAR_2026 } from '../taxYear2026';

/**
 * Section 4 — IRA branch.
 *
 * Computes MAGI from total household salary minus YTD pre-tax 401(k)
 * contributions and routes the user to one of three actions based on
 * filing status and MAGI band:
 *
 *   Single  > $153k  /  MFJ > $242k       → backdoor Roth IRA
 *   Single  $81–$153k / MFJ $129–$242k    → direct Roth IRA
 *   Single  < $81k   /  MFJ < $129k       → traditional vs. Roth choice
 *                                            (the "expect higher income?" Q)
 *
 * Phase-out windows ($153–$168k single, $242–$252k MFJ for Roth;
 * $81–$91k single, $129–$149k MFJ for traditional deductibility) are
 * surfaced in evidence so users in the middle see exactly where they
 * sit, not just "you're in the Roth band."
 *
 * Treatment of unsupported filing statuses (MFS, HOH): for now we fall
 * back to the single bands and surface a "treating as single" note in
 * evidence. The IRS rules for MFS are notably stricter; honest copy
 * here is better than silently picking the wrong band.
 */

type FilingBand = 'low' | 'mid' | 'high';

interface Bands {
  /** Traditional-IRA deduction phase-out (start = full deductibility ends). */
  tradDeductStart: number;
  tradDeductEnd: number;
  /** Roth direct-contribution phase-out (start = full contribution ends). */
  rothStart: number;
  rothEnd: number;
}

function bandsFor(filingStatus: string): Bands {
  if (filingStatus === 'MFJ') {
    return {
      tradDeductStart: TAX_YEAR_2026.traditionalIRADeduction.marriedPhaseOutStart,
      tradDeductEnd:   TAX_YEAR_2026.traditionalIRADeduction.marriedPhaseOutEnd,
      rothStart:       TAX_YEAR_2026.roth.marriedPhaseOutStart,
      rothEnd:         TAX_YEAR_2026.roth.marriedPhaseOutEnd,
    };
  }
  return {
    tradDeductStart: TAX_YEAR_2026.traditionalIRADeduction.singlePhaseOutStart,
    tradDeductEnd:   TAX_YEAR_2026.traditionalIRADeduction.singlePhaseOutEnd,
    rothStart:       TAX_YEAR_2026.roth.singlePhaseOutStart,
    rothEnd:         TAX_YEAR_2026.roth.singlePhaseOutEnd,
  };
}

function classifyMagi(magi: number, bands: Bands): FilingBand {
  if (magi >= bands.rothStart) return 'high';        // Above Roth start → backdoor territory
  if (magi >= bands.tradDeductStart) return 'mid';   // In direct-Roth window
  return 'low';                                       // Trad-deductibility still possible
}

function isPretaxRetirementContribution(
  contribution: { accountId: number },
  accounts: { id?: number; type: string }[],
): boolean {
  const account = accounts.find((a) => a.id === contribution.accountId);
  if (!account) return false;
  // 401(k) and traditional IRA both reduce MAGI; Roth IRAs do not. Roth 401(k)
  // is post-tax too — deliberately excluded so it does NOT reduce MAGI.
  return account.type === AccountType.ACCOUNT_401K || account.type === AccountType.ACCOUNT_TRAD_IRA;
}

export function computeMagi(ctx: RoadmapContext): number {
  const salary = ctx.persons.reduce((s, p) => s + (p.annualSalaryPretax ?? 0), 0);
  const year = ctx.today.getFullYear();
  const yearPrefix = `${year}-`;
  const ytdPretax = ctx.contributions
    .filter((c) => c.date.startsWith(yearPrefix))
    .filter((c) => isPretaxRetirementContribution(c, ctx.accounts))
    .reduce((s, c) => s + c.amount, 0);
  return Math.max(0, salary - ytdPretax);
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * Top of the IRA branch. Computes MAGI and surfaces which sub-branch
 * applies. Returns 'info' so the user sees the routing without it
 * blocking the downstream action nodes — the actions own the "active"
 * status on the path the user is actually walking.
 */
export function evaluateIraBand(ctx: RoadmapContext): NodeResult {
  const magi = computeMagi(ctx);
  const filingStatus = ctx.household.filingStatus;
  const bands = bandsFor(filingStatus);
  const band = classifyMagi(magi, bands);

  const notice = (filingStatus === 'MFS' || filingStatus === 'HOH')
    ? ` (treating ${filingStatus} as single — verify the IRS rule for your situation)`
    : '';

  if (band === 'high') {
    return {
      status: 'info',
      evidence: `MAGI ${formatUSD(magi)} is above the Roth phase-out start (${formatUSD(bands.rothStart)})${notice}. Backdoor Roth applies.`,
    };
  }
  if (band === 'mid') {
    const inPhaseOut = magi >= bands.rothStart * 0.95 && magi < bands.rothEnd;
    const phaseOutHint = inPhaseOut
      ? ` (Roth phase-out: ${formatUSD(bands.rothStart)}–${formatUSD(bands.rothEnd)} — contribution may be partial)`
      : '';
    return {
      status: 'info',
      evidence: `MAGI ${formatUSD(magi)} is in the direct-Roth band${notice}${phaseOutHint}.`,
    };
  }
  // low band
  return {
    status: 'info',
    evidence: `MAGI ${formatUSD(magi)} is below the traditional-deduction phase-out start (${formatUSD(bands.tradDeductStart)})${notice}. Traditional vs. Roth is the open question.`,
  };
}

/**
 * Backdoor-Roth action — active only when MAGI puts the user above the
 * Roth direct-contribution start.
 */
export function evaluateBackdoorRoth(ctx: RoadmapContext): NodeResult {
  const magi = computeMagi(ctx);
  const bands = bandsFor(ctx.household.filingStatus);
  const band = classifyMagi(magi, bands);
  if (band === 'high') {
    return {
      status: 'active',
      evidence: `MAGI ${formatUSD(magi)} ≥ ${formatUSD(bands.rothStart)} (Roth phase-out start) — direct Roth contribution restricted. Be aware of the IRS pro-rata rule on any pre-tax IRA balance.`,
      cta: { label: 'Open Accounts →', href: '/accounts' },
    };
  }
  return {
    status: 'skipped',
    evidence: `MAGI ${formatUSD(magi)} below ${formatUSD(bands.rothStart)} — direct Roth still allowed.`,
  };
}

/**
 * Direct Roth IRA action — active when MAGI is in the mid band (above
 * traditional-deduction phase-out start but below Roth phase-out).
 */
export function evaluateRothIra(ctx: RoadmapContext): NodeResult {
  const magi = computeMagi(ctx);
  const bands = bandsFor(ctx.household.filingStatus);
  const band = classifyMagi(magi, bands);
  if (band === 'mid') {
    return {
      status: 'active',
      evidence: `MAGI ${formatUSD(magi)} in direct-Roth band (${formatUSD(bands.tradDeductStart)}–${formatUSD(bands.rothStart)}).`,
      cta: { label: 'Open Accounts →', href: '/accounts' },
    };
  }
  if (band === 'high') {
    return {
      status: 'skipped',
      evidence: `MAGI ${formatUSD(magi)} above ${formatUSD(bands.rothStart)} — backdoor Roth path instead.`,
    };
  }
  return {
    status: 'skipped',
    evidence: `MAGI ${formatUSD(magi)} below ${formatUSD(bands.tradDeductStart)} — traditional-vs-Roth choice node owns this band.`,
  };
}

/**
 * Traditional IRA action — active when MAGI is in the low band AND the
 * person has answered "no" to "do you expect higher future income?" (so
 * the deduction is preferable to a Roth for the current year).
 */
export function evaluateTraditionalIra(ctx: RoadmapContext): NodeResult {
  const magi = computeMagi(ctx);
  const bands = bandsFor(ctx.household.filingStatus);
  const band = classifyMagi(magi, bands);
  if (band !== 'low') {
    return {
      status: 'skipped',
      evidence: `MAGI ${formatUSD(magi)} above ${formatUSD(bands.tradDeductStart)} — Roth or backdoor path applies instead.`,
    };
  }
  const expectsHigher = ctx.persons.some((p) => p.expectsHigherFutureIncome === true);
  const expectsLower = ctx.persons.every((p) => p.expectsHigherFutureIncome === false);
  if (expectsHigher) {
    return {
      status: 'skipped',
      evidence: 'You expect higher future income — Roth IRA is the recommended branch even at low MAGI.',
    };
  }
  if (!expectsLower) {
    return {
      status: 'not-started',
      evidence: 'Answer "Do you expect future income to exceed the IRS threshold?" first.',
    };
  }
  return {
    status: 'active',
    evidence: `MAGI ${formatUSD(magi)} below ${formatUSD(bands.tradDeductStart)} and you do not expect higher future income — traditional IRA deduction available.`,
    cta: { label: 'Open Accounts →', href: '/accounts' },
  };
}
