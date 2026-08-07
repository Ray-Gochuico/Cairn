import { describe, it, expect } from 'vitest';
import { evaluateThread } from '@/domain/interview/evaluate';
import { NEXT_DOLLAR_THREAD } from '@/domain/interview/threads/next-dollar';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';
import { fixtureCtx } from '../../lib/interview/waterfall.test';

describe('next_dollar thread', () => {
  it('is registered first, household-scoped, with the stable id', () => {
    expect(INTERVIEW_THREADS[0].id).toBe('next_dollar');
    expect(NEXT_DOLLAR_THREAD.scope).toBe('household');
    expect(NEXT_DOLLAR_THREAD.subject).toBeUndefined();
  });

  it('unanswered (no session submission) → asks q_amount', () => {
    const r = evaluateThread(NEXT_DOLLAR_THREAD, fixtureCtx(), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_amount');
    expect(r.node.storage.kind).toBe('session');
  });

  it('a session submission walks to reply_frameworks (cards render from the bar)', () => {
    const session = new Map([['q_amount', { amountCents: 1_000_000, cadence: 'one-time' }]]);
    const r = evaluateThread(NEXT_DOLLAR_THREAD, fixtureCtx(), '', session);
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply).toEqual({ kind: 'framework-cards' });
  });

  it('rejects a malformed session value (typed controls only — asks again)', () => {
    const session = new Map([['q_amount', { amountCents: -5, cadence: 'weekly' }]]);
    const r = evaluateThread(NEXT_DOLLAR_THREAD, fixtureCtx(), '', session);
    expect(r.state).toBe('ask');
  });
});
