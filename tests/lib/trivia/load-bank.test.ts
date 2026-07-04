import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  loadTriviaBank,
  reviewedOnly,
  findDuplicateIds,
  __resetTriviaBankCacheForTests,
} from '@/lib/trivia/load-bank';
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

});

// SEC-1: cross-row id collisions are invisible to per-row schema validation;
// the loader must catch them (a dup id makes the daily selector ambiguous).
// This exercises the REAL exported scanner (the previous version of this
// test asserted against a local detectDupes copy, not the shipped code).
describe('findDuplicateIds', () => {
  it('returns each duplicated id once, in first-collision order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }, { id: 'a' }];
    expect(findDuplicateIds(rows)).toEqual(['a', 'b']);
  });
  it('returns [] when all ids are unique', () => {
    expect(findDuplicateIds([{ id: 'a' }, { id: 'b' }])).toEqual([]);
  });
  it('returns [] for an empty bank', () => {
    expect(findDuplicateIds([])).toEqual([]);
  });
});

describe('loadTriviaBank promise cache', () => {
  beforeEach(() => __resetTriviaBankCacheForTests());

  it('two calls return the SAME promise (dashboard card + /learn share one parse)', async () => {
    const p1 = loadTriviaBank();
    const p2 = loadTriviaBank();
    expect(p1).toBe(p2);
    // Settle before the test ends so this load's parse can't bleed into the
    // next test's parse-count spy.
    await p1;
  });

  it('the bank is schema-parsed exactly once across repeated calls', async () => {
    const parseSpy = vi.spyOn(TriviaBankSchema, 'parse');
    await Promise.all([loadTriviaBank(), loadTriviaBank()]);
    await loadTriviaBank(); // post-settle call reuses the cache too (static asset)
    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });
});
