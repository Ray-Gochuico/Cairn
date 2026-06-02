import { describe, it, expect } from 'vitest';
import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';
import { QuestionFormat, Topic } from '@/types/enums';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  isPrimarySourceCitation,
  answerOf,
  parseNumericAnswer,
  promptJaccard,
  JACCARD_THRESHOLD,
  DEFAULT_MATH_TOLERANCE,
} from '@/lib/trivia/integrity-constants';
import { getGlossaryEntry } from '@/lib/glossary';
import staging from '@/data/trivia/bank-v1.staging.json';
import bank from '@/data/trivia/bank-v1.json';

/**
 * Staging integrity harness for bank-v1.staging.json.
 *
 * During the authoring loop (L2.7b), draft batches live here as reviewed:false
 * until the user signs off. On approval, rows are moved to bank-v1.json and
 * staging becomes empty. BOTH states are valid:
 *   - non-empty: the harness checks structural soundness of pending drafts.
 *   - empty: all drafts have been approved and promoted; the suite skips.
 *
 * Structural soundness is NOT validation — the user sign-off (review-log) is
 * the sole accuracy gate.
 */
const stagingRows: TriviaQuestion[] = TriviaBankSchema.parse(staging);
const shippedRows: TriviaQuestion[] = TriviaBankSchema.parse(bank);

describe('trivia staging seed batches — structural integrity', () => {
  it('every staging row is schema-valid and reviewed:false (never auto-servable)', () => {
    // An empty staging file is valid (all batches approved and promoted).
    expect(stagingRows.every((q) => q.reviewed === false)).toBe(true);
  });

  it('staging ids are unique and do not collide with the shipped bank', () => {
    const stagingIds = stagingRows.map((q) => q.id);
    expect(new Set(stagingIds).size).toBe(stagingIds.length);
    const shipped = new Set(shippedRows.map((q) => q.id));
    const collisions = stagingIds.filter((id) => shipped.has(id));
    expect(collisions).toEqual([]);
  });

  it('proves the loop on two batches: a high-liability topic and a math batch', () => {
    // Skip when staging is empty (all seed batches have been approved and promoted).
    if (stagingRows.length === 0) return;
    expect(stagingRows.some((q) => isHighLiability(q.topic))).toBe(true);
    expect(stagingRows.some((q) => q.format === QuestionFormat.MATH)).toBe(true);
  });

  it('every high-liability staging row cites a real primary source', () => {
    const offenders = stagingRows
      .filter((q) => isHighLiability(q.topic))
      .filter((q) => !isPrimarySourceCitation(q.source))
      .map((q) => `${q.id}: "${q.source}"`);
    expect(offenders).toEqual([]);
  });

  it('no high-liability staging row uses a bare inflation-adjusted figure as its answer', () => {
    const offenders = stagingRows
      .filter((q) => isHighLiability(q.topic))
      .filter((q) => isBareRotFigureAnswer(answerOf(q)))
      .map((q) => `${q.id}: "${answerOf(q)}"`);
    expect(offenders).toEqual([]);
  });

  it('every staging row has 4 distinct choices', () => {
    const offenders = stagingRows.filter((q) => new Set(q.choices).size !== 4).map((q) => q.id);
    expect(offenders).toEqual([]);
  });

  it('every math staging row self-verifies against an independent check (within tolerance)', () => {
    const mathQs = stagingRows.filter((q) => q.format === QuestionFormat.MATH);
    // Skip when staging is empty (all math batches promoted to bank-v1.json).
    if (mathQs.length === 0) return;
    const offenders: string[] = [];
    for (const q of mathQs) {
      const answer = parseNumericAnswer(answerOf(q));
      if (Number.isNaN(answer)) {
        offenders.push(`${q.id}: answer "${answerOf(q)}" not numeric`);
        continue;
      }
      if (!q.check) {
        offenders.push(`${q.id}: missing check{}`);
        continue;
      }
      // Recompute INDEPENDENTLY from check.expr (does not echo the stored answer).
      let computed = q.check.expected;
      if (q.check.expr) {
        // eslint-disable-next-line no-new-func
        computed = Function(`"use strict"; return (${q.check.expr});`)() as number;
        if (Math.abs(computed - q.check.expected) > (q.check.tolerance ?? DEFAULT_MATH_TOLERANCE)) {
          offenders.push(`${q.id}: check.expr ${computed} ≠ check.expected ${q.check.expected}`);
          continue;
        }
      }
      const tol = q.check.tolerance ?? DEFAULT_MATH_TOLERANCE;
      if (Math.abs(answer - computed) > tol) {
        offenders.push(`${q.id}: |${answer} - ${computed}| > ${tol}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every staging glossaryTerm resolves', () => {
    const unresolved = stagingRows
      .filter((q) => q.glossaryTerm)
      .filter((q) => getGlossaryEntry(q.glossaryTerm as string) === null)
      .map((q) => q.glossaryTerm);
    expect(unresolved).toEqual([]);
  });

  it('has no near-duplicate prompts within the staging set (token-Jaccard)', () => {
    const offenders: string[] = [];
    for (let i = 0; i < stagingRows.length; i++) {
      for (let j = i + 1; j < stagingRows.length; j++) {
        const sim = promptJaccard(stagingRows[i].prompt, stagingRows[j].prompt);
        if (sim > JACCARD_THRESHOLD) {
          offenders.push(`${stagingRows[i].id} ~ ${stagingRows[j].id} (${sim.toFixed(2)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the two seed batches cover Taxes/Beginner and Investments/Advanced', () => {
    // Skip when staging is empty (both seed batches have been approved and are
    // now in bank-v1.json). The bank-side harness (trivia-bank.test.ts coverage
    // floors) verifies the promoted counts going forward.
    if (stagingRows.length === 0) return;
    const taxesBeg = stagingRows.filter(
      (q) => q.topic === Topic.TAXES && q.difficulty === 'Beginner',
    );
    const invAdv = stagingRows.filter(
      (q) => q.topic === Topic.INVESTMENTS && q.difficulty === 'Advanced',
    );
    expect(taxesBeg.length).toBeGreaterThanOrEqual(10);
    expect(invAdv.length).toBeGreaterThanOrEqual(10);
  });
});
