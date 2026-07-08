import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuestionFormat, Topic } from '@/types/enums';

// The dynamic `import('@/data/trivia/bank-v1.json')` inside loadTriviaBank is
// swapped per-test with vi.doMock + a FRESH module graph (vi.resetModules), so
// each case exercises the real throw arm (SEC-1) — not a re-implementation.
const validRow = (id: string) => ({
  id,
  version: 1,
  difficulty: 'Beginner',
  format: QuestionFormat.DEFINITION,
  topic: Topic.FOUNDATIONS,
  prompt: `p ${id}`,
  choices: ['a', 'b', 'c', 'd'],
  answerIndex: 0,
  explanation: 'e',
  source: 'IRS Pub 17',
  reviewed: true,
});

async function loadWithBank(rows: unknown) {
  vi.doMock('@/data/trivia/bank-v1.json', () => ({ default: rows }));
  const mod = await import('@/lib/trivia/load-bank');
  mod.__resetTriviaBankCacheForTests();
  return mod;
}

describe('loadTriviaBank — failure arm (SEC-1)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/data/trivia/bank-v1.json');
  });

  it('REJECTS on a malformed bank (schema parse throws inside the cached promise)', async () => {
    const { loadTriviaBank } = await loadWithBank([{ id: 'broken' }]);
    await expect(loadTriviaBank()).rejects.toThrow();
  });

  it('REJECTS naming the duplicate ids (cross-row uniqueness is not schema-visible)', async () => {
    const { loadTriviaBank } = await loadWithBank([validRow('dup-1'), validRow('dup-1')]);
    await expect(loadTriviaBank()).rejects.toThrow(/duplicate question ids: dup-1/);
  });

  it('the dupe guard runs on the FULL set before the reviewed filter (a draft dupe still fails loudly)', async () => {
    const draft = { ...validRow('dup-2'), reviewed: false };
    const { loadTriviaBank } = await loadWithBank([validRow('dup-2'), draft]);
    await expect(loadTriviaBank()).rejects.toThrow(/dup-2/);
  });

  it('CACHES the rejection: both consumers share one settled promise', async () => {
    const { loadTriviaBank } = await loadWithBank([{ id: 'broken' }]);
    const p1 = loadTriviaBank();
    const p2 = loadTriviaBank();
    expect(p1).toBe(p2); // identity — the page and the dashboard card share one parse
    await expect(p1).rejects.toThrow();
  });
});
