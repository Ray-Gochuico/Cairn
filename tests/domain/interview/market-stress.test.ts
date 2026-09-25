import { describe, it, expect } from 'vitest';
import { evaluateThread } from '@/domain/interview/evaluate';
import { MARKET_STRESS_THREAD } from '@/domain/interview/threads/market-stress';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { AccountType } from '@/types/enums';
import { makeAccount } from '../../factories';
import { fixtureCtx, snap } from '../../lib/interview/fixture';

const brokerage = makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' });
const invested = (extra = {}) => fixtureCtx({
  accounts: [...fixtureCtx().accounts, brokerage],
  snapshots: [...fixtureCtx().snapshots, snap(3, 100_000)],
  ...extra,
});
const row = (valueJson: string, answeredAt = '2026-07-01T12:00:00.000Z'): [string, InterviewAnswer] => [
  answerKey('market_stress', 'q_mix', ''),
  { id: 1, householdId: 1, threadId: 'market_stress', questionId: 'q_mix', subjectKey: '', valueJson, questionVersion: 1, answeredAt, basisJson: '{"branch":"has-portfolio"}' },
];

describe('market_stress thread — the walk (D-R4-4)', () => {
  it('stable ids + household scope + no per-instance subject', () => {
    expect(MARKET_STRESS_THREAD.id).toBe('market_stress');
    expect(MARKET_STRESS_THREAD.title).toBe('Market stress');
    expect(MARKET_STRESS_THREAD.entry).toBe('d_portfolio');
    expect(MARKET_STRESS_THREAD.nodes.map((n) => n.id)).toEqual(['d_portfolio', 'q_mix', 'reply_stress']);
    expect(MARKET_STRESS_THREAD.subject).toBeUndefined();
  });

  it('⚑ R4-F16: hidden on cash + savings only (the shared fixture), and with an excluded brokerage', () => {
    expect(evaluateThread(MARKET_STRESS_THREAD, fixtureCtx(), '')).toEqual({ state: 'hidden' });
    const excluded = fixtureCtx({
      accounts: [...fixtureCtx().accounts, makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: true })],
      snapshots: [...fixtureCtx().snapshots, snap(3, 100_000)],
    });
    expect(evaluateThread(MARKET_STRESS_THREAD, excluded, '')).toEqual({ state: 'hidden' });
  });

  it('an invested balance asks q_mix (CI-MS-Q/O, stale 24, persisted) with the has-portfolio basis and its facts', () => {
    const r = evaluateThread(MARKET_STRESS_THREAD, invested(), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_mix');
    expect(r.node.prompt).toBe('How is your portfolio split between stocks and bonds?');
    expect(r.node.answer).toEqual({ kind: 'enum', options: [
      { value: 'stocks-100', label: 'All stocks' }, { value: 'stocks-75', label: '75% stocks, 25% bonds' },
      { value: 'stocks-60', label: '60% stocks, 40% bonds' }, { value: 'stocks-40', label: '40% stocks, 60% bonds' },
    ] });
    expect(r.node.staleAfterMonths).toBe(24);
    expect(r.node.storage).toEqual({ kind: 'interview-answer' });
    // The replayed pv is the FI-eligible sum (cash counts — the card's prefill rule); the GATE is the invested sum.
    expect(r.pinBasis).toEqual({ branch: 'has-portfolio', facts: { portfolioDollars: 130_000, investedDollars: 100_000, contributionDollarsPerYear: 0 } });
  });

  it('answered stocks-75 → the plan reply: title + CI-MS-1 on $130,000; five window lines in registry order', () => {
    const r = evaluateThread(MARKET_STRESS_THREAD, invested({ interviewAnswers: new Map([row('"stocks-75"')]) }), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') return;
    expect(r.reply.title).toBe('Market stress');
    expect(r.reply.lines[0]).toBe("Your $130,000 portfolio — from your latest account snapshots — replayed through five historical windows at a 75% stocks / 25% bonds mix, in today's dollars.");
    expect(r.reply.lines).toHaveLength(6);
    expect(r.reply.lines.slice(1).map((l) => l.split(' (')[0])).toEqual(['The 1929 crash', 'The 1970s inflation run', 'The dot-com crash', 'The 2008 crash', 'The 2022 inflation shock']);
    expect(r.reply.assumes.at(-1)).toBe('Every start year, not just these windows — the Stress Test card and the Backtest tool on Calculators.');
    expect(r.answeredPath.map((p) => p.node.id)).toEqual(['q_mix']);
  });

  it('a 25-month-old answer still renders the reply, flagged for the CI-34 banner', () => {
    const r = evaluateThread(MARKET_STRESS_THREAD, invested({ interviewAnswers: new Map([row('"stocks-60"', '2024-06-15T12:00:00.000Z')]) }), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.staleAnswers.map((s) => s.node.id)).toEqual(['q_mix']);
    // The STORED mix drives the reply (a mutant that ignores the answer reds here).
    if (r.reply.kind !== 'plan') throw new Error('expected the plan reply');
    expect(r.reply.lines[0]).toContain('at a 60% stocks / 40% bonds mix');
  });

  it('D-GI16: a value outside the roster re-asks as unanswered', () => {
    const r = evaluateThread(MARKET_STRESS_THREAD, invested({ interviewAnswers: new Map([row('"stocks-50"')]) }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.reason).toBe('unanswered');
    expect(r.priorAnswer).toBeNull();
  });

  it('determinism: identical ctx twice → deep-equal replies', () => {
    const a = invested({ interviewAnswers: new Map([row('"stocks-75"')]) });
    const b = invested({ interviewAnswers: new Map([row('"stocks-75"')]) });
    expect(evaluateThread(MARKET_STRESS_THREAD, a, '')).toEqual(evaluateThread(MARKET_STRESS_THREAD, b, ''));
  });
});
