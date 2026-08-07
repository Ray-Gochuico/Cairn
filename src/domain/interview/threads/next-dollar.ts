import { z } from 'zod';
import type { InterviewThread } from '@/types/interview';

/**
 * Thread 1 — the "$X — what's next?" bar (design §4.1). One session-only
 * question, one terminal reply. The reply MARKER is all the kernel emits;
 * the QuestionBar builds the three FrameworkCardModels itself via
 * buildFrameworkCards (same pure pipeline — the kernel walk proves the
 * graph shape and validates the typed value; D-GI13 keeps the hypothetical
 * out of the database).
 * IDs are stable forever: next_dollar / q_amount / reply_frameworks.
 */
export const NEXT_DOLLAR_THREAD: InterviewThread = {
  id: 'next_dollar',
  title: "What's next for a dollar",
  scope: 'household',
  entry: 'q_amount',
  nodes: [
    {
      kind: 'preference',
      id: 'q_amount',
      version: 1,
      prompt: "I have $X — what's next?",
      answer: { kind: 'amount-cadence' },
      valueSchema: z.object({
        amountCents: z.number().int().positive().max(1_000_000_000), // ≤ $10,000,000
        cadence: z.enum(['one-time', 'per-month']),
      }),
      storage: { kind: 'session' },
      branches: { '*': 'reply_frameworks' },
    },
    {
      kind: 'reply',
      id: 'reply_frameworks',
      compute: () => ({ kind: 'framework-cards' }),
    },
  ],
};
