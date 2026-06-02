import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  isPrimarySourceCitation,
  answerOf,
  parseNumericAnswer,
  DEFAULT_MATH_TOLERANCE,
} from '@/lib/trivia/integrity-constants';
import { QuestionFormat } from '@/types/enums';

/**
 * Env-gated draft DRIVER for the authoring loop (gen spec §6 step 1–2). It only
 * runs under `DRAFT_TRIVIA=1` so `npm test` never writes files or depends on it.
 *
 * Role: VALIDATE + STAGE only. The operator drafts a batch OUTSIDE CI (LLM, using
 * the generation spec as the prompt + the reviewed 60 as few-shot exemplars),
 * sets DRAFT_TRIVIA_BATCH to a JSON file of the new reviewed:false rows, and runs:
 *
 *   DRAFT_TRIVIA=1 DRAFT_TRIVIA_BATCH=/path/to/batch.json \
 *     npx vitest run tests/scripts/draft-trivia-batch.gen.test.ts
 *
 * The driver appends the batch to src/data/trivia/bank-v1.staging.json after
 * checking it passes the integrity rules (schema, primary-source citation,
 * no-rot-figure, math self-verify, distinct distractors, reviewed:false, no id
 * collision with staging OR the shipped bank). It NEVER touches bank-v1.json —
 * approval (after review) is a separate, manual move (gen spec §6 step 4).
 *
 * GREEN here means STRUCTURALLY sound, NOT validated. The user sign-off is the
 * sole accuracy gate.
 */
const RUN = process.env.DRAFT_TRIVIA === '1';
const STAGING = resolve(process.cwd(), 'src/data/trivia/bank-v1.staging.json');

function structuralOffenders(rows: TriviaQuestion[]): string[] {
  const offenders: string[] = [];
  for (const q of rows) {
    if (q.reviewed !== false) offenders.push(`${q.id}: drafts must be reviewed:false`);
    if (new Set(q.choices).size !== 4) offenders.push(`${q.id}: choices not 4-distinct`);
    if (isHighLiability(q.topic) && !isPrimarySourceCitation(q.source)) {
      offenders.push(`${q.id}: high-liability needs a primary source (got "${q.source}")`);
    }
    if (isHighLiability(q.topic) && isBareRotFigureAnswer(answerOf(q))) {
      offenders.push(`${q.id}: bare inflation-adjusted figure as answer "${answerOf(q)}"`);
    }
    if (q.format === QuestionFormat.MATH) {
      const ans = parseNumericAnswer(answerOf(q));
      if (Number.isNaN(ans)) offenders.push(`${q.id}: math answer not numeric`);
      else if (!q.check) offenders.push(`${q.id}: math missing check{}`);
      else if (Math.abs(ans - q.check.expected) > (q.check.tolerance ?? DEFAULT_MATH_TOLERANCE)) {
        offenders.push(`${q.id}: math self-verify failed`);
      }
    }
  }
  return offenders;
}

describe.skipIf(!RUN)('draft-trivia-batch (on-demand staging driver)', () => {
  it('validates a drafted batch and appends it to the staging file', () => {
    const batchPath = process.env.DRAFT_TRIVIA_BATCH;
    expect(batchPath, 'set DRAFT_TRIVIA_BATCH=/path/to/batch.json').toBeTruthy();

    const batch = TriviaBankSchema.parse(JSON.parse(readFileSync(batchPath as string, 'utf-8')));
    const existing: TriviaQuestion[] = existsSync(STAGING)
      ? TriviaBankSchema.parse(JSON.parse(readFileSync(STAGING, 'utf-8')))
      : [];

    // No id collision with staging.
    const stagingIds = new Set(existing.map((q) => q.id));
    const collisions = batch.filter((q) => stagingIds.has(q.id)).map((q) => q.id);
    expect(collisions, 'batch ids collide with staging').toEqual([]);

    // Structural integrity (NOT validation).
    expect(structuralOffenders(batch)).toEqual([]);

    const merged = [...existing, ...batch];
    writeFileSync(STAGING, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

    // Re-read + re-validate to prove the file is well-formed.
    const reread = TriviaBankSchema.parse(JSON.parse(readFileSync(STAGING, 'utf-8')));
    expect(reread.length).toBe(merged.length);
  });
});
