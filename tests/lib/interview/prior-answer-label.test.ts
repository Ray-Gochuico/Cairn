import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { priorAnswerLabel } from '@/lib/interview/prior-answer-label';
import { YEAR_MONTH_SCHEMA, type AnswerSpec, type PreferenceNode, type StoredAnswerView } from '@/types/interview';

const node = (answer: AnswerSpec, valueSchema: z.ZodType<unknown>): PreferenceNode => ({
  kind: 'preference', id: 'q', version: 2, prompt: 'p', answer, valueSchema,
  storage: { kind: 'interview-answer' }, branches: { '*': 'r' },
});
const prior = (value: unknown): StoredAnswerView =>
  ({ value, questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z', basis: null });
const COMPOUND = z.object({ amountDollars: z.number().positive(), targetMonth: YEAR_MONTH_SCHEMA });
const TOLERANT = z.preprocess(
  (v) => (v != null && typeof v === 'object' && 'targetMonth' in (v as object) ? (v as { targetMonth: unknown }).targetMonth : v),
  YEAR_MONTH_SCHEMA,
);

describe('priorAnswerLabel (F12, CR-AP-2)', () => {
  it('amount → currency', () => {
    expect(priorAnswerLabel(node({ kind: 'amount' }, z.number().positive()), prior(60000))).toBe('$60,000');
  });
  it('month-year → Month YYYY', () => {
    expect(priorAnswerLabel(node({ kind: 'month-year' }, YEAR_MONTH_SCHEMA), prior('2028-06'))).toBe('June 2028');
  });
  it('amount-month-year → "$X by Month YYYY"', () => {
    expect(priorAnswerLabel(node({ kind: 'amount-month-year' }, COMPOUND), prior({ amountDollars: 60000, targetMonth: '2028-06' }))).toBe('$60,000 by June 2028');
  });
  it('enum → the option label', () => {
    const n = node({ kind: 'enum', options: [{ value: 'a', label: 'Alpha' }] }, z.enum(['a']));
    expect(priorAnswerLabel(n, prior('a'))).toBe('Alpha');
  });
  it('a LEGACY compound row on a month-year node (the college shape after a future bump) formats through the tolerant schema', () => {
    expect(priorAnswerLabel(node({ kind: 'month-year' }, TOLERANT), prior({ amountDollars: 123, targetMonth: '2030-09' }))).toBe('September 2030');
  });
  it('unparseable or absent → null (no preamble)', () => {
    expect(priorAnswerLabel(node({ kind: 'month-year' }, YEAR_MONTH_SCHEMA), prior({ targetMonth: 12 }))).toBeNull();
    expect(priorAnswerLabel(node({ kind: 'amount' }, z.number()), null)).toBeNull();
  });
});
