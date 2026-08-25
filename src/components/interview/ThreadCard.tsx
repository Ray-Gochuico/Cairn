import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import type { InterviewContext, InterviewThread, SubjectKey, ThreadEvaluation } from '@/types/interview';
import { AnswerPrompt } from './AnswerPrompt';
import { HouseGoalCta } from './HouseGoalCta';
import { recordUpcomingPurchase, type HouseTarget } from '@/domain/interview/threads/home-purchase';

const monthYear = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One thread instance: ask state → AnswerPrompt (with CI-36/CI-37
 *  preambles), reply state → lines + assumes + per-answer CI-34 stale
 *  banners and CI-35 "Ask me again". All copy from the evaluation. */
export function ThreadCard({ thread, subject, ctx, evaluation }: {
  thread: InterviewThread;
  subject: SubjectKey;
  ctx: InterviewContext;
  evaluation: ThreadEvaluation;
}) {
  const saveAnswer = useInterviewAnswersStore((s) => s.saveAnswer);
  const clearAnswer = useInterviewAnswersStore((s) => s.clearAnswer);
  if (evaluation.state === 'hidden') return null;

  if (evaluation.state === 'ask') {
    const { node, reason, priorAnswer, pinBasis } = evaluation;
    const prompt = typeof node.prompt === 'function' ? node.prompt(ctx, subject) : node.prompt;
    const priorLabel = node.answer.kind === 'enum' && priorAnswer != null
      ? node.answer.options.find((o) => o.value === priorAnswer.value)?.label ?? String(priorAnswer.value)
      : priorAnswer != null ? String(priorAnswer.value) : null;
    return (
      <Card className="p-4 space-y-1" data-testid={`thread-${thread.id}-${subject}`}>
        {reason === 'version-changed' && priorLabel != null && (
          <p className="text-xs text-muted-foreground">
            This question changed since you answered. Your earlier answer: '{priorLabel}'.
          </p>
        )}
        {reason === 'basis-changed' && (
          <p className="text-xs text-muted-foreground">The car this answer was about has changed — asking again.</p>
        )}
        <AnswerPrompt
          prompt={prompt}
          spec={node.answer}
          onSubmit={async (value) => {
            // Review m4: write-path validation — the node's schema guards the
            // row BEFORE it can persist (the read side already Zod-parses,
            // D-GI16). Failure surfaces through AnswerPrompt's existing
            // inline error path; the message is its shipped fallback copy.
            const parsed = node.valueSchema.safeParse(value);
            if (!parsed.success) throw new Error('Could not save your answer.');
            await saveAnswer({
              threadId: thread.id, questionId: node.id, subjectKey: subject,
              value: parsed.data, questionVersion: node.version,
              basis: pinBasis == null ? null : { branch: pinBasis.branch, ...pinBasis.facts },
            });
            // D-HP4: home-purchase q_target additionally write-throughs the
            // household's upcoming-purchase columns (the s5 consistency
            // contract). The kernel's entity-column write side is unwired —
            // this dispatch is the sanctioned substitute (plan T2).
            if (thread.id === 'home_purchase' && node.id === 'q_target') {
              await recordUpcomingPurchase(parsed.data as HouseTarget, ctx.today);
            }
          }}
        />
      </Card>
    );
  }

  const { reply, answeredPath, staleAnswers } = evaluation;
  return (
    <Card className="p-4 space-y-2" data-testid={`thread-${thread.id}-${subject}`}>
      {reply.kind === 'plan' && <div className="text-sm font-semibold">{reply.title}</div>}
      {reply.kind !== 'framework-cards' &&
        reply.lines.map((l, i) => <p key={i} className="text-sm">{l}</p>)}
      {reply.kind === 'plan' &&
        reply.assumes.map((a, i) => <p key={i} className="text-xs text-muted-foreground">{a}</p>)}
      {thread.id === 'home_purchase' && reply.kind === 'plan' && (() => {
        const hit = answeredPath.find(({ node }) => node.id === 'q_target');
        return hit ? <HouseGoalCta target={hit.answer.value as HouseTarget} /> : null;
      })()}
      {staleAnswers.map(({ node, answer }) => (
        <div key={node.id} className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>Answered {monthYear(answer.answeredAt!)} — still true?</span>
          <Button size="sm" variant="outline"
            onClick={() => saveAnswer({
              threadId: thread.id, questionId: node.id, subjectKey: subject,
              value: answer.value, questionVersion: node.version,
              basis: answer.basis, // re-confirm: same value, fresh answered_at
            })}>
            Still true
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearAnswer(thread.id, node.id, subject)}>
            Change answer
          </Button>
        </div>
      ))}
      <div className="flex gap-2 flex-wrap">
        {answeredPath.filter(({ node }) => node.storage.kind === 'interview-answer').map(({ node }) => (
          // Review m7: adjacent multi-answer buttons keep the CI-35 visible
          // text byte-identical; the ACCESSIBLE name alone is disambiguated
          // with the node's prompt (a11y metadata, not visible copy).
          <Button key={node.id} size="sm" variant="ghost"
            aria-label={`Ask me again: ${typeof node.prompt === 'function' ? node.prompt(ctx, subject) : node.prompt}`}
            onClick={() => clearAnswer(thread.id, node.id, subject)}>
            Ask me again
          </Button>
        ))}
      </div>
    </Card>
  );
}
