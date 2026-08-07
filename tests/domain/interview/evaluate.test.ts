import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { evaluateThread, subjectsOf, monthsBetweenIso } from '@/domain/interview/evaluate';
import { answerKey } from '@/types/interview';
import type {
  InterviewAnswer, InterviewContext, InterviewThread,
} from '@/types/interview';
import { makeHousehold, makePerson, makeVehicle } from '../../factories';

function ctxWith(overrides: Partial<InterviewContext> = {}): InterviewContext {
  return {
    household: makeHousehold(), persons: [makePerson({ id: 1 })],
    accounts: [], loans: [], contributions: [], snapshots: [], transactions: [],
    categories: [], overrides: new Map(), thresholds: { low: 5, high: 8 },
    taxYear: 2026, today: new Date('2026-08-01T12:00:00Z'),
    vehicles: [], assetValueSnapshots: [], settings: null, holdings: [], tickers: [],
    interviewAnswers: new Map(),
    ...overrides,
  } as InterviewContext;
}

function storedRow(partial: Partial<InterviewAnswer>): InterviewAnswer {
  return {
    id: 1, householdId: 1, threadId: 't', questionId: 'q1', subjectKey: '',
    valueJson: '"a"', questionVersion: 1, answeredAt: '2026-07-01T00:00:00.000Z',
    basisJson: null, ...partial,
  };
}

const THREAD: InterviewThread = {
  id: 't', title: 'Test', scope: 'household', entry: 'd1',
  nodes: [
    {
      kind: 'data-branch', id: 'd1',
      evaluate: (ctx) => ctx.loans.length > 0
        ? { branch: 'has-loans', facts: { n: ctx.loans.length } }
        : { branch: 'quiet', facts: {} },
      branches: { 'has-loans': 'q1', quiet: null },
    },
    {
      kind: 'preference', id: 'q1', version: 2, prompt: 'Pick one',
      answer: { kind: 'enum', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      valueSchema: z.enum(['a', 'b']), staleAfterMonths: 12,
      storage: { kind: 'interview-answer' },
      branches: { a: 'r1', b: 'r1' },
    },
    { kind: 'reply', id: 'r1', compute: () => ({ kind: 'info', lines: ['done'] }) },
  ],
};

const LOAN = { currentBalance: 100 } as never; // only .length is read by d1

describe('evaluateThread', () => {
  it('data-branch → null branch hides the thread', () => {
    expect(evaluateThread(THREAD, ctxWith(), '')).toEqual({ state: 'hidden' });
  });

  it('unanswered preference asks, pinning the upstream data-branch basis', () => {
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN] }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q1');
    expect(r.reason).toBe('unanswered');
    expect(r.pinBasis).toEqual({ branch: 'has-loans', facts: { n: 1 } });
  });

  it('a current answer walks through to the reply, recording the answered path', () => {
    const answers = new Map([[answerKey('t', 'q1', ''), storedRow({ questionVersion: 2, valueJson: '"a"' })]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply).toEqual({ kind: 'info', lines: ['done'] });
    expect(r.answeredPath.map((p) => p.node.id)).toEqual(['q1']);
    expect(r.staleAnswers).toEqual([]);
  });

  it('question_version < node version re-asks with the prior answer renderable (CI-36)', () => {
    const answers = new Map([[answerKey('t', 'q1', ''), storedRow({ questionVersion: 1 })]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.reason).toBe('version-changed');
    expect(r.priorAnswer?.value).toBe('a');
  });

  it('a changed data-branch basis invalidates the answer (CI-37)', () => {
    // Answered while branch was 'has-loans'; pin says so — evaluate under the
    // same branch but with a DIFFERENT pinned branch string in basis_json.
    const answers = new Map([[
      answerKey('t', 'q1', ''),
      storedRow({ questionVersion: 2, basisJson: '{"branch":"something-else"}' }),
    ]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.reason).toBe('basis-changed');
  });

  it('an age-stale answer still reaches the reply, flagged for the CI-34 banner', () => {
    const answers = new Map([[
      answerKey('t', 'q1', ''),
      storedRow({ questionVersion: 2, answeredAt: '2025-07-15T00:00:00.000Z' }), // 12+ months old
    ]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.staleAnswers.map((s) => s.node.id)).toEqual(['q1']);
  });

  it('D-GI16 letter (review m5): corrupt AND version-stale is unanswered — never version-changed with an undefined prior', () => {
    // A row that is both Zod-invalid and version-stale must not surface as
    // 'version-changed' — that renders "Your earlier answer: 'undefined'".
    const answers = new Map([[
      answerKey('t', 'q1', ''),
      storedRow({ questionVersion: 1, valueJson: '"not-an-option"' }), // node version is 2
    ]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.reason).toBe('unanswered');
    expect(r.priorAnswer).toBeNull();
  });

  it('D-GI16: a corrupt stored value re-asks as unanswered — never crashes', () => {
    const answers = new Map([[
      answerKey('t', 'q1', ''),
      storedRow({ questionVersion: 2, valueJson: '"not-an-option"' }),
    ]]);
    const r = evaluateThread(THREAD, ctxWith({ loans: [LOAN], interviewAnswers: answers }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.reason).toBe('unanswered');
    expect(r.priorAnswer).toBeNull();
  });

  it('session answers feed session-storage nodes and are never age-stale', () => {
    const sessionThread: InterviewThread = {
      ...THREAD, entry: 'q1',
      nodes: THREAD.nodes.map((n) =>
        n.id === 'q1' && n.kind === 'preference'
          ? { ...n, storage: { kind: 'session' as const }, staleAfterMonths: 1 }
          : n),
    };
    const r = evaluateThread(sessionThread, ctxWith(), '', new Map([['q1', 'b']]));
    expect(r.state).toBe('reply');
  });

  it('subjectsOf enumerates vehicles for per-vehicle threads and [""] otherwise', () => {
    const ctx = ctxWith({ vehicles: [makeVehicle({ id: 4 }), makeVehicle({ id: 9 })] });
    expect(subjectsOf({ ...THREAD, subject: { kind: 'vehicle' } }, ctx)).toEqual(['vehicle:4', 'vehicle:9']);
    expect(subjectsOf(THREAD, ctx)).toEqual(['']);
  });

  it('monthsBetweenIso is whole calendar months', () => {
    expect(monthsBetweenIso('2025-07-15', '2026-08-01')).toBe(13);
    expect(monthsBetweenIso('2026-08-01', '2026-08-31')).toBe(0);
  });
});
