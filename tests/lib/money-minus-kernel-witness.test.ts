/**
 * v1.7.1 M1 (STOP-K ruling K-A): the FROZEN interview kernel inherits the money
 * minus through `formatCurrency`. Its SOURCE is byte-untouched (`git diff main
 * --stat -- src/domain/interview src/lib/interview` is EMPTY) and no kernel pin
 * or seeded string moves (every Appendix-A figure is non-negative). These two
 * witnesses make the inherited glyph visible where the kernel renders it. They
 * pin ONLY the glyph — a prefix, and no ASCII hyphen before a dollar — never
 * the rest of the negative-portfolio copy, which is a Lane K item.
 */
import { describe, it, expect } from 'vitest';
import { computeMarketStress, renderMarketStress } from '@/lib/interview/market-stress';
import { evaluateThread } from '@/domain/interview/evaluate';
import { COLLEGE_VS_RETIREMENT_THREAD } from '@/domain/interview/threads/college-vs-retirement';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { AccountType } from '@/types/enums';
import { makeAccount, makeDependent, makeHousehold, makePerson } from '../factories';
import { fixtureCtx, snap } from './interview/fixture';

describe('money minus reaches the frozen kernel by inheritance (v1.7.1 M1, K-A)', () => {
  it('CI-MS-1/2: a negative FI-eligible sum (checking below zero, invested > 0) reads "Your −$4,000 portfolio", every window figure "−$", none "-$"', () => {
    const ctx = fixtureCtx({
      household: makeHousehold({
        monthlyExpenseBaseline: 6000, withdrawalRate: 0.04, inflationAssumption: 0.024,
        growthScenarios: [{ label: 'Conservative', rate: 0.05 }, { label: 'Moderate', rate: 0.06 }, { label: 'Optimistic', rate: 0.07 }],
      }),
      persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1988-04-12' })],
      accounts: [
        makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
        makeAccount({ id: 2, type: AccountType.ACCOUNT_CASH, name: 'Checking' }),
      ],
      snapshots: [snap(1, 1_000), snap(2, -5_000)],
      loans: [],
    });
    const { lines } = renderMarketStress(computeMarketStress(ctx, 'stocks-75'));
    expect(lines[0]).toMatch(/^Your −\$4,000 portfolio — /);
    for (const l of lines.slice(1)) expect(l).toContain('−$');
    for (const l of lines) expect(l).not.toContain('-$');
  });

  it('CI-C7: a negative 529 snapshot reads "−$2,000 across 529 accounts … ≈ −$1,763", none "-$"', () => {
    const row = (questionId: string, valueJson: string, basisBranch: string): [string, InterviewAnswer] => [
      answerKey('college_vs_retirement', questionId, ''),
      { id: 1, householdId: 1, threadId: 'college_vs_retirement', questionId, subjectKey: '', valueJson, questionVersion: 1,
        answeredAt: '2026-07-01T12:00:00.000Z', basisJson: JSON.stringify({ branch: basisBranch }) },
    ];
    const ctx = fixtureCtx({
      household: makeHousehold({ state: 'CA', inflationAssumption: 0.03, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
      dependents: [makeDependent({ id: 1, name: 'Maya', dateOfBirth: '2018-08-15' })],
      accounts: [
        makeAccount({ id: 9, type: AccountType.ACCOUNT_529, name: 'College 529' }),
        makeAccount({ id: 2, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
      ],
      snapshots: [snap(9, -2_000), snap(2, 800_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '5', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected the tradeoff plan reply');
    expect(r.reply.lines[1]).toMatch(/^−\$2,000 across 529 accounts plus \$5\/mo grows to ≈ −\$1,763 by /);
    for (const l of r.reply.lines) expect(l).not.toContain('-$');
  });
});
