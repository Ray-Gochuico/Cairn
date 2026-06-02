import { describe, it, expect } from 'vitest';
import { TriviaBankSchema } from '@/lib/trivia/bank-schema';
import { getGlossaryEntry } from '@/lib/glossary';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  answerOf,
} from '@/lib/trivia/integrity-constants';
import bank from '@/data/trivia/bank-v1.json';

describe('bank-v1.json integrity', () => {
  it('parses through TriviaBankSchema', () => {
    expect(() => TriviaBankSchema.parse(bank)).not.toThrow();
  });

  it('has unique ids', () => {
    const ids = (bank as Array<{ id: string }>).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every glossaryTerm resolves in the glossary', () => {
    const parsed = TriviaBankSchema.parse(bank);
    const unresolved = parsed
      .filter((q) => q.glossaryTerm)
      .filter((q) => getGlossaryEntry(q.glossaryTerm as string) === null)
      .map((q) => q.glossaryTerm);
    expect(unresolved).toEqual([]);
  });

  it('contains at least one Beginner and one Advanced question', () => {
    const parsed = TriviaBankSchema.parse(bank);
    expect(parsed.some((q) => q.difficulty === 'Beginner')).toBe(true);
    expect(parsed.some((q) => q.difficulty === 'Advanced')).toBe(true);
  });

  // L3.3b — de-rot: a high-liability question must NOT use a bare inflation-
  // adjusted figure ($X / Y% / threshold) as the GRADED answer (it rots every
  // tax year). Statutory constants on the shared allowlist (e.g. "$35,000",
  // "73", "3.8%") are exempt. Figures in `explanation` are always allowed —
  // only the answer key is gated. The harness (L2.4) reuses these helpers.
  it('no high-liability question uses a bare inflation-adjusted figure as its answer', () => {
    const parsed = TriviaBankSchema.parse(bank);
    const offenders = parsed
      .filter((q) => isHighLiability(q.topic))
      .filter((q) => isBareRotFigureAnswer(answerOf(q)))
      .map((q) => `${q.id}: "${answerOf(q)}"`);
    expect(offenders).toEqual([]);
  });
});
