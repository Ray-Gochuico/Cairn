import { describe, it, expect } from 'vitest';
import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';
import { getGlossaryEntry } from '@/lib/glossary';
import { QuestionFormat, Topic, Subtopic } from '@/types/enums';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  answerOf,
} from '@/lib/trivia/integrity-constants';
import { reviewedOnly } from '@/lib/trivia/load-bank';
import { COVERAGE_FLOORS } from '@/lib/trivia/coverage-floors';
import bank from '@/data/trivia/bank-v1.json';

// Parse once. Throws (failing the suite loudly) if any row is malformed — which
// is exactly what we want from the integrity gate.
const parsed: TriviaQuestion[] = TriviaBankSchema.parse(bank);

describe('bank-v1.json integrity', () => {
  it('parses through TriviaBankSchema', () => {
    expect(() => TriviaBankSchema.parse(bank)).not.toThrow();
  });

  // ---- L2.2: schema/enum at scale + id uniqueness ----

  it('has unique ids', () => {
    const ids = parsed.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every format/topic/subtopic is a valid enum member at scale', () => {
    const formats = new Set<string>(Object.values(QuestionFormat));
    const topics = new Set<string>(Object.values(Topic));
    const subtopics = new Set<string>(Object.values(Subtopic));
    for (const q of parsed) {
      expect(formats.has(q.format)).toBe(true);
      expect(topics.has(q.topic)).toBe(true);
      if (q.subtopic !== undefined) expect(subtopics.has(q.subtopic)).toBe(true);
    }
  });

  // ---- L2.10: glossaryTerm resolvability over the full bank ----

  it('every glossaryTerm resolves in the glossary', () => {
    const unresolved = parsed
      .filter((q) => q.glossaryTerm)
      .filter((q) => getGlossaryEntry(q.glossaryTerm as string) === null)
      .map((q) => q.glossaryTerm);
    expect(unresolved).toEqual([]);
  });

  it('contains at least one Beginner and one Advanced question', () => {
    expect(parsed.some((q) => q.difficulty === 'Beginner')).toBe(true);
    expect(parsed.some((q) => q.difficulty === 'Advanced')).toBe(true);
  });

  // ---- L2.6: reviewed-only-servable (asserted AFTER the L3.3a backfill) ----

  it('the reviewed pool is non-empty with ≥1 Beginner + ≥1 Advanced', () => {
    const pool = reviewedOnly(parsed);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((q) => q.difficulty === 'Beginner')).toBe(true);
    expect(pool.some((q) => q.difficulty === 'Advanced')).toBe(true);
  });

  // ---- L2.3: ratcheted per-topic coverage floors ----
  // Floors START at the backfilled counts and are raised one batch at a time as
  // the authoring loop approves content (gen spec §4/§6). They are NEVER allowed
  // to demand more than what is approved, so the suite is always green against
  // what's shipped — but a REGRESSION (deleting/un-reviewing approved content)
  // drops a count below its floor and reds.

  it('meets the ratcheted per-topic coverage floors (reviewed pool)', () => {
    const pool = reviewedOnly(parsed);
    const count = (topic: Topic, difficulty: 'Beginner' | 'Advanced') =>
      pool.filter((q) => q.topic === topic && q.difficulty === difficulty).length;
    const shortfalls: string[] = [];
    for (const [topic, floors] of Object.entries(COVERAGE_FLOORS)) {
      const b = count(topic as Topic, 'Beginner');
      const a = count(topic as Topic, 'Advanced');
      if (b < floors.Beginner) shortfalls.push(`${topic}/Beginner: ${b} < ${floors.Beginner}`);
      if (a < floors.Advanced) shortfalls.push(`${topic}/Advanced: ${a} < ${floors.Advanced}`);
    }
    expect(shortfalls).toEqual([]);
  });

  // ---- L2.4 / L3.3b: no bare inflation-adjusted figure as the graded answer ----
  // (statutory allowlist exempt; figures in `explanation` always allowed)

  it('no high-liability question uses a bare inflation-adjusted figure as its answer', () => {
    const offenders = parsed
      .filter((q) => isHighLiability(q.topic))
      .filter((q) => isBareRotFigureAnswer(answerOf(q)))
      .map((q) => `${q.id}: "${answerOf(q)}"`);
    expect(offenders).toEqual([]);
  });
});
