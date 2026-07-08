import { z } from 'zod';
import { QuestionFormat, Topic, Subtopic } from '@/types/enums';

/**
 * Per-question shape for the lazy-loaded trivia bank
 * (src/data/trivia/bank-v1.json). `difficulty` is "Beginner" | "Advanced"
 * only — "Mixed" is a user preference (LearningDifficulty), never a
 * per-question tag. See docs/superpowers/specs/2026-05-28-trivia-learning-spec.md §5.
 *
 * Learning v2 (L3): the free-text `tags` array is REMOVED in favour of the
 * controlled `format`/`topic` (required) + optional `subtopic` taxonomy
 * (src/types/enums.ts). The schema is intentionally NON-strict, so a legacy
 * `tags` key on an un-migrated row is silently dropped during the backfill
 * transition rather than throwing.
 *
 * Review gate (D3): `reviewed` (default false) + optional `reviewedBy`/
 * `reviewedAt`. The load-filter (load-bank.ts) serves only `reviewed:true`
 * rows, so drafts never reach a user. `source` stays `min(1)` here — the
 * citation-QUALITY gate (reject "src"/non-primary sources for high-liability
 * topics) lives in the integrity harness, not a schema refine, so drafts flow
 * through and get caught with a clear failure list.
 *
 * `check` (optional, harness-only): lets `math` questions carry an independent
 * recompute target. The app ignores it; the integrity harness asserts
 * Number(choices[answerIndex]) ≈ check.expected within tolerance.
 */
export const TriviaQuestionSchema = z
  .object({
    // Kebab lowercase only: answeredKey() builds `id@vN`, so '@' (or any
    // charset surprise) in an id would corrupt the answered-key grammar.
    id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'question id must be kebab-case [a-z0-9-]'),
    version: z.number().int().positive(),
    difficulty: z.enum(['Beginner', 'Advanced']),
    format: z.nativeEnum(QuestionFormat),
    topic: z.nativeEnum(Topic),
    subtopic: z.nativeEnum(Subtopic).optional(),
    glossaryTerm: z.string().optional(),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
    source: z.string().min(1),
    reviewed: z.boolean().default(false),
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(), // ISO date string; kept as string to avoid a date-parse dep
    check: z
      .object({
        expr: z.string().optional(),
        expected: z.number(),
        tolerance: z.number().optional(),
      })
      .optional(),
  })
  .refine((q) => q.answerIndex < q.choices.length, {
    message: 'answerIndex out of range',
    path: ['answerIndex'],
  });
export type TriviaQuestion = z.infer<typeof TriviaQuestionSchema>;

export const TriviaBankSchema = z.array(TriviaQuestionSchema);
