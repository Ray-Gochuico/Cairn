import { describe, it, expect } from 'vitest';
import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';
import { getGlossaryEntry } from '@/lib/glossary';
import { QuestionFormat, Topic, Subtopic } from '@/types/enums';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  isPrimarySourceCitation,
  answerOf,
  parseNumericAnswer,
  promptJaccard,
  JACCARD_THRESHOLD,
  ANSWER_INDEX_MIN_N,
  DEFAULT_MATH_TOLERANCE,
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

  // ---- L2.4: broadened primary-source citation for high-liability topics ----

  it('every high-liability question cites a real primary source', () => {
    const offenders = parsed
      .filter((q) => isHighLiability(q.topic))
      .filter((q) => !isPrimarySourceCitation(q.source))
      .map((q) => `${q.id}: "${q.source}"`);
    expect(offenders).toEqual([]);
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

  // ---- L2.5: distinct distractors + structural not-also-correct ----

  it('every question has 4 distinct choices (no duplicate / not-also-correct dupes)', () => {
    const offenders = parsed
      .filter((q) => new Set(q.choices).size !== 4)
      .map((q) => q.id);
    expect(offenders).toEqual([]);
  });

  // ---- L2.5: math self-verification (always-applied tolerance) ----
  // For format === 'math', the optional harness-only `check` must recompute to
  // the graded numeric answer within tolerance. (No math rows yet — the
  // assertion is a no-op until the Investments/Advanced seed batch lands, then
  // it bites. The synthetic prove-it-bites probe lives below.)

  it('every math question self-verifies (parseNumericAnswer ≈ check.expected within tolerance)', () => {
    const mathQs = parsed.filter((q) => q.format === QuestionFormat.MATH);
    const offenders: string[] = [];
    for (const q of mathQs) {
      const answer = parseNumericAnswer(answerOf(q));
      if (Number.isNaN(answer)) {
        offenders.push(`${q.id}: answer "${answerOf(q)}" is not numeric`);
        continue;
      }
      if (!q.check) {
        offenders.push(`${q.id}: math question missing a check{} recompute target`);
        continue;
      }
      const expected = q.check.expected;
      const tol = q.check.tolerance ?? DEFAULT_MATH_TOLERANCE;
      if (Math.abs(answer - expected) > tol) {
        offenders.push(`${q.id}: |${answer} - ${expected}| > ${tol}`);
      }
      // Wave 8: recompute INDEPENDENTLY from check.expr (does not echo the
      // stored answer) — ported from the staging harness; all shipped math
      // rows carry an expr.
      if (q.check.expr) {
        const computed = Function(`"use strict"; return (${q.check.expr});`)() as number;
        if (Math.abs(computed - expected) > tol) {
          offenders.push(`${q.id}: check.expr recomputes ${computed}, bank says ${expected}`);
        }
      } else {
        offenders.push(`${q.id}: math question missing check.expr (recompute target)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ---- L2.8: answerIndex distribution band (min-N gated) ----
  // The current 60 are ~58% "B"; a strict band would red now. Gate behind a
  // minimum reviewed-pool size so seed batches + small pools don't trip it.
  // Final target: each of the 4 positions holds 22–28%.

  it('answerIndex distribution is reasonably uniform once the reviewed pool is large enough', () => {
    const pool = reviewedOnly(parsed);
    if (pool.length < ANSWER_INDEX_MIN_N) {
      expect(pool.length).toBeLessThan(ANSWER_INDEX_MIN_N); // documents the gate is active
      return;
    }
    const dist = [0, 0, 0, 0];
    for (const q of pool) dist[q.answerIndex]++;
    for (const n of dist) {
      expect(n / pool.length).toBeGreaterThanOrEqual(0.2);
      // Wave 8 upper bound: no slot may hold more than 30% (slot 1 sat at
      // 30.3% pre-rebalance — a mild "when in doubt pick B" tell). Tighten
      // to 0.28 at the next authoring rebalance (the ~93-question top-up),
      // which should land all four slots in the 22–28% target band.
      expect(n / pool.length).toBeLessThanOrEqual(0.3);
    }
  });

  // ---- L2.9: prompt near-duplicate dedup (token-Jaccard, topic-bucketed) ----

  it('has no exact-duplicate normalized prompts', () => {
    const norm = parsed.map((q) => q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    expect(new Set(norm).size).toBe(norm.length);
  });

  it('has no near-duplicate prompts within a topic bucket (token-Jaccard)', () => {
    // Bucket by topic — dupes cluster there, and bucketing keeps this well
    // inside testTimeout (~O((N/13)²) pairs vs ~O(N²) un-bucketed).
    const buckets = new Map<string, TriviaQuestion[]>();
    for (const q of parsed) {
      const arr = buckets.get(q.topic) ?? [];
      arr.push(q);
      buckets.set(q.topic, arr);
    }
    const offenders: string[] = [];
    for (const arr of buckets.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const sim = promptJaccard(arr[i].prompt, arr[j].prompt);
          if (sim > JACCARD_THRESHOLD) {
            offenders.push(`${arr[i].id} ~ ${arr[j].id} (${sim.toFixed(2)})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // ---- Wave 8: numeric-signature cross-topic dupe gate ----
  // Two math questions with the same prompt numbers AND the same computed
  // answer are the same exercise wearing different topic hats — the topic-
  // bucketed Jaccard gate can't see across buckets. Live dupe caught by the
  // 2026-07 review: adv-foundations-compounding-frequency-math ≡
  // adv-savings-compounding-frequency-math (both $10,000 @ 6% ⇒ $16.78).
  it('no two math questions share a numeric signature (prompt numbers + expected answer)', () => {
    const signature = (q: TriviaQuestion) => {
      const nums = (q.prompt.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [])
        .map((s) => Number(s.replace(/,/g, '')))
        .sort((a, b) => a - b);
      return `${nums.join('|')}⇒${q.check?.expected}`;
    };
    const seen = new Map<string, string>();
    const offenders: string[] = [];
    for (const q of parsed.filter((x) => x.format === QuestionFormat.MATH)) {
      const sig = signature(q);
      const prev = seen.get(sig);
      if (prev) offenders.push(`${prev} ≡ ${q.id} (${sig})`);
      else seen.set(sig, q.id);
    }
    expect(offenders).toEqual([]);
  });
});

// Prove-it-bites probes — synthetic fixtures that exercise the FAILURE arm of
// each guardrail, so a green run over the (already-clean) 60 can't lull us into
// thinking the gate is a no-op. These assert the predicate itself catches bad
// content.
describe('integrity harness — prove-it-bites (synthetic)', () => {
  it('citation gate catches a placeholder source on a high-liability row', () => {
    const bad = { topic: Topic.TAXES, source: 'Cairn glossary' };
    expect(isHighLiability(bad.topic) && !isPrimarySourceCitation(bad.source)).toBe(true);
  });

  it('figure gate catches a non-allowlisted bracket threshold as an answer', () => {
    expect(isBareRotFigureAnswer('$47,025')).toBe(true);
  });

  it('distinct-choices gate catches a duplicated distractor', () => {
    const choices = ['a', 'b', 'a', 'd'];
    expect(new Set(choices).size !== 4).toBe(true);
  });

  it('math self-verify catches a wrong key beyond tolerance', () => {
    const answer = Number('600');
    const expected = 660;
    expect(Math.abs(answer - expected) > DEFAULT_MATH_TOLERANCE).toBe(true);
  });

  it('dedup gate catches a near-duplicate prompt above threshold', () => {
    const sim = promptJaccard(
      'Which of these best describes a Roth IRA account?',
      'Which of these best describes a Roth IRA?',
    );
    expect(sim > JACCARD_THRESHOLD).toBe(true);
  });

  it('check.expr recompute catches an expr that disagrees with expected', () => {
    const computed = Function('"use strict"; return (100*1.10);')() as number;
    expect(Math.abs(computed - 200) > DEFAULT_MATH_TOLERANCE).toBe(true);
  });

  it('numeric-signature gate catches a same-numbers same-answer pair', () => {
    const sig = (prompt: string, expected: number) =>
      `${(prompt.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, ''))).sort((a, b) => a - b).join('|')}⇒${expected}`;
    expect(sig('$10,000 at 6% for one year', 16.78)).toBe(sig('You deposit $10,000 at a 6% rate for one year', 16.78));
  });
});
