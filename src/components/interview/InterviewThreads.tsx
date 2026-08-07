import { evaluateThread, subjectsOf } from '@/domain/interview/evaluate';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';
import type { InterviewContext } from '@/types/interview';
import { ThreadCard } from './ThreadCard';

/** The "Questions for you" strip (design §4): every registered thread ×
 *  subject that surfaces, in registry order. Renders NOTHING when no
 *  thread surfaces — no false empty state. next_dollar renders as the
 *  bar, never here. */
export function InterviewThreads({ ctx }: { ctx: InterviewContext }) {
  const entries = INTERVIEW_THREADS
    .filter((t) => t.id !== 'next_dollar')
    .flatMap((thread) =>
      subjectsOf(thread, ctx).map((subject) => ({
        thread, subject, evaluation: evaluateThread(thread, ctx, subject),
      })))
    .filter((e) => e.evaluation.state !== 'hidden');
  if (entries.length === 0) return null;
  return (
    <section aria-label="Questions for you" className="space-y-3">
      <h2 className="text-lg font-semibold">Questions for you</h2>
      {entries.map((e) => (
        <ThreadCard key={`${e.thread.id}:${e.subject}`} thread={e.thread} subject={e.subject}
          ctx={ctx} evaluation={e.evaluation} />
      ))}
    </section>
  );
}
