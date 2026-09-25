import { z } from 'zod';
import { kernelScenario } from '@/lib/interview/effects';
import {
  MIX_KEYS, MIX_OPTIONS, computeMarketStress, investedBalance, renderMarketStress, type MixKey,
} from '@/lib/interview/market-stress';
import type { InterviewContext, InterviewThread } from '@/types/interview';

/**
 * Thread 5 — market stress (R4, D-R4-4; the W1 phase-3 thread). Surfaces on an
 * INVESTED balance (⚑ R4-F16 — a checking-only household is not asked its
 * stock/bond split); one persisted enum (the mix — session storage is unwired
 * in the strip, spec Finding 2); a reply that replays the household's
 * FI-eligible portfolio through the five STRESS_WINDOWS on the Backtest's real
 * basis, one calm line per window in REGISTRY order, each ending with the
 * FI-target delay from two identical solves (never an absolute age — the
 * Earliest Retirement card is that figure's one home). Stable IDs forever:
 * market_stress / d_portfolio / q_mix / reply_stress.
 */
function portfolioBranch(ctx: InterviewContext): { branch: string; facts: Record<string, unknown> } {
  const invested = investedBalance(ctx);
  const { defaults } = kernelScenario(ctx);
  const facts = {
    portfolioDollars: defaults.portfolio,
    investedDollars: invested,
    contributionDollarsPerYear: defaults.annualContribution,
  };
  return invested > 0 ? { branch: 'has-portfolio', facts } : { branch: 'none', facts };
}

export const MARKET_STRESS_THREAD: InterviewThread = {
  id: 'market_stress',
  title: 'Market stress',
  scope: 'household',
  entry: 'd_portfolio',
  nodes: [
    {
      kind: 'data-branch',
      id: 'd_portfolio',
      evaluate: (ctx) => portfolioBranch(ctx),
      branches: { 'has-portfolio': 'q_mix', none: null },
    },
    {
      kind: 'preference',
      id: 'q_mix',
      version: 1,
      prompt: 'How is your portfolio split between stocks and bonds?',
      answer: { kind: 'enum', options: MIX_OPTIONS.map(({ value, label }) => ({ value, label })) },
      valueSchema: z.enum(MIX_KEYS),
      staleAfterMonths: 24,
      storage: { kind: 'interview-answer' },
      branches: { '*': 'reply_stress' },
    },
    {
      kind: 'reply',
      id: 'reply_stress',
      compute: (ctx, answers) => ({
        kind: 'plan',
        ...renderMarketStress(computeMarketStress(ctx, answers.get('q_mix') as MixKey)),
      }),
    },
  ],
};
