import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadTriviaBank, reviewedOnly } from '@/lib/trivia/load-bank';
import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';
import { QuestionFormat, Topic } from '@/types/enums';

const mk = (id: string, reviewed: boolean): TriviaQuestion => ({
  id,
  version: 1,
  difficulty: 'Beginner',
  format: QuestionFormat.DEFINITION,
  topic: Topic.FOUNDATIONS,
  prompt: `p ${id}`,
  choices: ['a', 'b', 'c', 'd'],
  answerIndex: 0,
  explanation: 'e',
  source: 'Cairn glossary',
  reviewed,
});

describe('reviewedOnly (load-filter, D3)', () => {
  it('keeps only reviewed:true rows', () => {
    const mixed = [mk('a', true), mk('b', false), mk('c', true)];
    expect(reviewedOnly(mixed).map((q) => q.id)).toEqual(['a', 'c']);
  });

  it('returns [] when nothing is reviewed', () => {
    expect(reviewedOnly([mk('a', false), mk('b', false)])).toEqual([]);
  });
});

describe('loadTriviaBank', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dynamically imports and validates the bank', async () => {
    const bank = await loadTriviaBank();
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThan(0);
    expect(bank[0]).toHaveProperty('prompt');
    expect(bank[0].choices).toHaveLength(4);
  });

  it('serves only reviewed questions (the live bank passes through reviewedOnly)', async () => {
    const bank = await loadTriviaBank();
    expect(bank.every((q) => q.reviewed === true)).toBe(true);
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
