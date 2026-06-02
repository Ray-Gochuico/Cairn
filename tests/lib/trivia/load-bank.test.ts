import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { TriviaBankSchema } from '@/lib/trivia/bank-schema';

describe('loadTriviaBank', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dynamically imports and validates the bank', async () => {
    const bank = await loadTriviaBank();
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThan(0);
    expect(bank[0]).toHaveProperty('prompt');
    expect(bank[0].choices).toHaveLength(4);
  });

  // SEC-1: a malformed bank must THROW (not silently degrade), so the page can
  // show the calm "couldn't load" state instead of a broken/empty quiz.
  it('throws on a malformed bank rather than returning a degraded value', () => {
    expect(() => TriviaBankSchema.parse([{ id: 'broken' }])).toThrow();
  });

  // SEC-1: cross-row id collisions are invisible to per-row schema validation;
  // the loader must catch them (a dup id makes the daily selector ambiguous).
  it('throws when two rows share an id', () => {
    const q = {
      id: 'beg-dup', version: 1, difficulty: 'Beginner',
      format: 'definition', topic: 'Foundations',
      prompt: 'p?', choices: ['a', 'b', 'c', 'd'], answerIndex: 0,
      explanation: 'e', source: 's',
    };
    const detectDupes = (rows: Array<{ id: string }>) => {
      const ids = rows.map((r) => r.id);
      return ids.some((id, i) => ids.indexOf(id) !== i);
    };
    expect(detectDupes([q, { ...q }])).toBe(true);
    expect(detectDupes([q, { ...q, id: 'beg-other' }])).toBe(false);
  });
});
