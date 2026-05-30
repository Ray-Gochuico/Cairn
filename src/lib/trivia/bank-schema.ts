import { z } from 'zod';

/**
 * Per-question shape for the lazy-loaded trivia bank
 * (src/data/trivia/bank-v1.json). `difficulty` is "Beginner" | "Advanced"
 * only — "Mixed" is a user preference (LearningDifficulty), never a
 * per-question tag. See docs/superpowers/specs/2026-05-28-trivia-learning-spec.md §5.
 */
export const TriviaQuestionSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    difficulty: z.enum(['Beginner', 'Advanced']),
    tags: z.array(z.string()).default([]),
    glossaryTerm: z.string().optional(),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
    source: z.string().min(1),
  })
  .refine((q) => q.answerIndex < q.choices.length, {
    message: 'answerIndex out of range',
    path: ['answerIndex'],
  });
export type TriviaQuestion = z.infer<typeof TriviaQuestionSchema>;

export const TriviaBankSchema = z.array(TriviaQuestionSchema);
