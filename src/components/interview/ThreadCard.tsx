import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useHouseholdStore } from '@/stores/household-store';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import type { InterviewContext, InterviewThread, SubjectKey, ThreadEvaluation } from '@/types/interview';
import { answerKey } from '@/types/interview';
import { AnswerPrompt } from './AnswerPrompt';
import { HouseGoalCta } from './HouseGoalCta';
import { recordUpcomingPurchase, type HouseTarget } from '@/domain/interview/threads/home-purchase';
import { localDayOfInstant, monthYearLabel } from '@/lib/interview/kernel-dates';
import { priorAnswerLabel } from '@/lib/interview/prior-answer-label';

/** U10 (R4): the LOCAL month of the answered_at instant. */
const answeredMonth = (iso: string): string => monthYearLabel(localDayOfInstant(iso).slice(0, 7));

/** The shipped save-failure fallback (AnswerPrompt / DecisionPrompt). */
const SAVE_FAILED = 'Could not save your answer.';

/** R4 review MINOR 0: the stored row's basis exactly as the ask state wrote it
 *  ({ branch, ...facts }). The evaluation's StoredAnswerView keeps the branch
 *  alone (the frozen kernel reads nothing else), so writing it back on a
 *  re-confirm would drop the pinned facts. Same acceptance rule as the
 *  kernel's read: a JSON object with a string branch, else null. */
function storedBasis(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof (parsed as { branch?: unknown }).branch === 'string') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // unparseable → null, as the kernel's read
  }
  return null;
}

/** One thread instance: ask state → AnswerPrompt (with CI-36/CI-37
 *  preambles), reply state → lines + assumes + per-answer CI-34 stale
 *  banners and CI-35 "Ask me again". All copy from the evaluation.
 *
 *  R4 (D-R4-7 / D-R4-P6): the strip is gated on DISCLOSURES.interview like the
 *  bar — the ask state's SUBMIT (the pending save proceeds after accept) and
 *  the reply state's RENDER (a reply carries the dataset and reference-data
 *  claims the document describes). Same modal semantics as QuestionBar: Escape
 *  does not dismiss, Cancel is the only non-accept exit. 'Still true' and 'Ask
 *  me again' live inside a rendered reply, so no un-gated write path exists. */
export function ThreadCard({ thread, subject, ctx, evaluation }: {
  thread: InterviewThread;
  subject: SubjectKey;
  ctx: InterviewContext;
  evaluation: ThreadEvaluation;
}) {
  const saveAnswer = useInterviewAnswersStore((s) => s.saveAnswer);
  const clearAnswer = useInterviewAnswersStore((s) => s.clearAnswer);
  const gate = useDisclosureGate('interview');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const [gateOpen, setGateOpen] = useState(false);
  const pendingRef = useRef<(() => Promise<void>) | null>(null);
  // R4 review MINOR 7: the deferred save runs after the modal has closed, so
  // neither the modal's nor AnswerPrompt's inline error can show its failure —
  // the card holds it and renders the shipped fallback under the prompt.
  const [deferredError, setDeferredError] = useState<string | null>(null);
  if (evaluation.state === 'hidden') return null;

  const modal = gateOpen && gate.state === 'needs-acceptance' ? (
    <DisclosureModal
      document={gate.document}
      continueLabel="Continue"
      dismissOnEscape={false}
      onAccept={async (v) => {
        await acceptDisclaimer('interview', v);
        setGateOpen(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) {
          try {
            await pending(); // the deferred ask-state save
          } catch {
            setDeferredError(SAVE_FAILED);
          }
        }
      }}
      onCancel={() => { pendingRef.current = null; setGateOpen(false); }}
    />
  ) : null;

  if (evaluation.state === 'ask') {
    const { node, reason, priorAnswer, pinBasis } = evaluation;
    const prompt = typeof node.prompt === 'function' ? node.prompt(ctx, subject) : node.prompt;
    const priorLabel = priorAnswerLabel(node, priorAnswer);
    const persist = async (value: unknown) => {
      await saveAnswer({
        threadId: thread.id, questionId: node.id, subjectKey: subject,
        value, questionVersion: node.version,
        basis: pinBasis == null ? null : { branch: pinBasis.branch, ...pinBasis.facts },
      });
      // D-HP4: home-purchase q_target additionally write-throughs the
      // household's upcoming-purchase columns (the s5 consistency
      // contract). The kernel's entity-column write side is unwired —
      // this dispatch is the sanctioned substitute (plan T2).
      if (thread.id === 'home_purchase' && node.id === 'q_target') {
        await recordUpcomingPurchase(value as HouseTarget, ctx.today);
      }
    };
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
            // D-GI16) and BEFORE the gate: an invalid value errors inline and
            // never opens the modal. Failure surfaces through AnswerPrompt's
            // existing inline error path; the message is its shipped fallback.
            setDeferredError(null);
            const parsed = node.valueSchema.safeParse(value);
            if (!parsed.success) throw new Error(SAVE_FAILED);
            if (gate.state === 'needs-acceptance') {
              pendingRef.current = () => persist(parsed.data);
              setGateOpen(true);
              return;
            }
            await persist(parsed.data);
          }}
        />
        {deferredError && (
          <div className="text-xs text-destructive-soft-foreground" role="alert">{deferredError}</div>
        )}
        {modal}
      </Card>
    );
  }

  const { reply, answeredPath, staleAnswers } = evaluation;
  if (gate.state === 'needs-acceptance') {
    return (
      <Card className="p-4 space-y-2" data-testid={`thread-${thread.id}-${subject}`}>
        <div className="text-sm font-semibold">{thread.title}</div>
        <p className="text-sm text-muted-foreground">Accept the About the Frameworks disclosure to see this card.</p>
        <Button size="sm" aria-label="Read and accept the Frameworks disclosure" onClick={() => setGateOpen(true)}>
          Read and accept
        </Button>
        {modal}
      </Card>
    );
  }
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
          <span>Answered {answeredMonth(answer.answeredAt!)} — still true?</span>
          <Button size="sm" variant="outline"
            onClick={() => {
              // R4 (D-R4-P11): re-confirm re-persists the PARSED value — a
              // legacy-shaped row (the college compound object) lands in the
              // current shape with a fresh answered_at; the tolerant read retires.
              // The basis is the row's own ({ branch, ...facts } — review MINOR 0).
              const parsed = node.valueSchema.safeParse(answer.value);
              const row = ctx.interviewAnswers.get(answerKey(thread.id, node.id, subject));
              void saveAnswer({
                threadId: thread.id, questionId: node.id, subjectKey: subject,
                value: parsed.success ? parsed.data : answer.value,
                questionVersion: node.version, basis: storedBasis(row?.basisJson) ?? answer.basis,
              });
            }}>
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
