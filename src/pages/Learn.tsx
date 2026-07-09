// empty-state-policy: allow — Learn gates its EmptyStates on the bespoke
// Wave-8 loading idiom (acceptancesStatus === 'loading' + learningState ===
// null), not a store isLoading flag or useLoadGate; the empty copy never
// paints before those settle.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailySet, nextStreak, localTodayISO } from '@/lib/trivia/daily';
import { useLocalToday } from '@/lib/use-local-today';
import { answeredKey } from '@/lib/trivia/answered-key';
import { getGlossaryEntry } from '@/lib/glossary';
import { LearningDifficulty } from '@/types/enums';
import { cn } from '@/lib/utils';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

const LETTERS = ['A', 'B', 'C', 'D'];

function DifficultyBadge({ difficulty }: { difficulty: TriviaQuestion['difficulty'] }) {
  // Beginner: info tint. Advanced: slate — must stay legible in dark mode
  // (lighter slate text on transparent fill in dark; see spec §10.3).
  const cls =
    difficulty === 'Beginner'
      ? 'bg-info-soft text-info-foreground border-info/30'
      : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-transparent dark:text-slate-300 dark:border-slate-600';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {difficulty}
    </span>
  );
}

// Wave 8: the persistent difficulty preference (revived from v1's
// learning_state column). House aria-pressed group (RealNominalToggle shape).
const PREFERENCE_OPTIONS = [
  { value: LearningDifficulty.BEGINNER, label: 'Basics' },
  { value: LearningDifficulty.MIXED, label: 'Mix' },
  { value: LearningDifficulty.ADVANCED, label: 'Going deeper' },
] as const;

function PreferenceToggle({
  value,
  onChange,
}: {
  value: LearningDifficulty;
  onChange: (v: LearningDifficulty) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span id="learn-difficulty-label" className="text-xs text-muted-foreground">
        Difficulty
      </span>
      <div
        role="group"
        aria-labelledby="learn-difficulty-label"
        className="inline-flex rounded border overflow-hidden"
      >
        {PREFERENCE_OPTIONS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2.5 py-1 text-xs transition-colors',
              i > 0 && 'border-l',
              value === opt.value && 'bg-primary text-primary-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Learn() {
  const navigate = useNavigate();
  const gate = useDisclosureGate('learning');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);

  const learningState = useLearningStore((s) => s.learningState);
  const learningError = useLearningStore((s) => s.error);
  const answeredKeysByDay = useLearningStore((s) => s.answeredKeysByDay);
  const answeredStats = useLearningStore((s) => s.answeredStats);
  const loadLearning = useLearningStore((s) => s.load);
  const updateLearning = useLearningStore((s) => s.update);
  const recordAnswer = useLearningStore((s) => s.recordAnswer);
  // The acceptances store is boot-loaded by AppDisclaimerGate for the whole
  // app; this page MUST NOT call load() itself (shared-store gate boot loop).
  // We only READ the status below.
  const acceptancesStatus = useAcceptancesStore((s) => s.status);

  const [bank, setBank] = useState<TriviaQuestion[] | null>(null);
  const [bankError, setBankError] = useState(false);
  // Per-question chosen index for the IN-SESSION reveal; a later same-day
  // visit rehydrates from the persisted chosen_index (todayDetails) instead.
  const [chosenById, setChosenById] = useState<Record<string, number>>({});
  // Stepper position by question ID (not index): a set re-derive (preference
  // toggle, day flip) keeps the user on the same card when it survives.
  const [stepId, setStepId] = useState<string | null>(null);
  // Where focus should land after the next render: the prompt heading after
  // Back/Next; the role=status reveal after answering (Wave 8 D3).
  const [focusTarget, setFocusTarget] = useState<'prompt' | 'reveal' | null>(null);
  const todayISO = useLocalToday();

  useEffect(() => {
    void loadHousehold();
    void loadLearning();
    // SEC-1: loadTriviaBank THROWS on a malformed/duplicate-id bank; catch it
    // so a corrupt bank surfaces as the calm "couldn't load" state below.
    loadTriviaBank().then(
      (b) => setBank(b),
      () => setBankError(true),
    );
  }, [loadHousehold, loadLearning]);

  // Midnight rollover (Wave 8 SHOULD-5): on a day flip, re-partition the
  // store's answered keys and reset the session UI to the fresh set.
  const prevDayRef = useRef(todayISO);
  useEffect(() => {
    if (prevDayRef.current === todayISO) return;
    prevDayRef.current = todayISO;
    setChosenById({});
    setStepId(null);
    setFocusTarget(null);
    void loadLearning();
  }, [todayISO, loadLearning]);

  const preference = learningState?.difficultyPreference ?? LearningDifficulty.MIXED;

  const questions = useMemo(() => {
    if (!bank || !learningState) return [];
    return selectDailySet({
      bank,
      answeredIds: answeredKeysByDay.priorDays,
      answeredTodayIds: answeredKeysByDay.today,
      todayISO,
      preference,
    });
  }, [bank, learningState, answeredKeysByDay, todayISO, preference]);

  const todaySet = useMemo(() => new Set(answeredKeysByDay.today), [answeredKeysByDay]);
  const todayDetails = answeredKeysByDay.todayDetails ?? [];
  const isAnsweredToday = (q: TriviaQuestion) =>
    todaySet.has(answeredKey(q.id, q.version)) || chosenById[q.id] !== undefined;
  // Session pick wins (freshest); otherwise the persisted chosen_index —
  // which is what makes explanations revisitable all day (Wave 8 D2).
  const chosenFor = (q: TriviaQuestion): number | undefined =>
    chosenById[q.id] ??
    todayDetails.find((d) => d.key === answeredKey(q.id, q.version))?.chosenIndex;

  // Land on the first unanswered question (index 0 when all answered), and
  // recover whenever the current stepId falls out of a re-derived set.
  useEffect(() => {
    if (questions.length === 0) return;
    if (stepId !== null && questions.some((q) => q.id === stepId)) return;
    const firstUnanswered = questions.findIndex((q) => !isAnsweredToday(q));
    setStepId(questions[firstUnanswered >= 0 ? firstUnanswered : 0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, stepId]);

  const stepIndex = Math.max(0, questions.findIndex((q) => q.id === stepId));
  const current: TriviaQuestion | undefined = questions[stepIndex];

  const promptRef = useRef<HTMLHeadingElement | null>(null);
  const revealRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusTarget === null) return;
    (focusTarget === 'prompt' ? promptRef.current : revealRef.current)?.focus();
    setFocusTarget(null);
  }, [focusTarget, stepId, chosenById]);

  if (!household) {
    return (
      <PageContainer width="prose">
        <EmptyState icon={GraduationCap} title="Set up your household to start learning.">
          <Button asChild size="sm" variant="outline">
            <Link to="/inputs/household">Set up household</Link>
          </Button>
        </EmptyState>
      </PageContainer>
    );
  }

  // Backend #4: while the acceptances projection is still loading, render a calm
  // placeholder — NOT the questions — so a cold deep-link can't flash gated content.
  if (acceptancesStatus === 'loading') {
    return (
      <PageContainer width="prose">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </PageContainer>
    );
  }

  if (gate.state === 'needs-acceptance') {
    return (
      <DisclosureModal
        document={gate.document}
        continueLabel="Open Learn"
        onAccept={(v) => acceptDisclaimer('learning', v)}
        onCancel={() => navigate('/')}
      />
    );
  }

  // Wave-8 MUST-1: honest failure state. The learning-store arm fires only
  // when the LOAD failed (error + no data) — a transient answer-write error
  // mid-session must not nuke a working quiz.
  if (bankError || (learningError !== null && learningState === null)) {
    return (
      <PageContainer width="prose">
        <Card className="p-6 space-y-2">
          <h1 className="text-2xl font-semibold">Learn</h1>
          <p className="text-sm text-muted-foreground">
            We couldn't load today's questions. Please refresh, or try again later.
          </p>
        </Card>
      </PageContainer>
    );
  }

  // Wave-8 MUST-1: still loading (bank chunk or learning store) — an
  // aria-busy placeholder, NEVER the exhausted state (which lied here before).
  if (!bank || !learningState) {
    return (
      <PageContainer width="prose">
        <div aria-busy="true" className="text-sm text-muted-foreground">
          Loading…
        </div>
      </PageContainer>
    );
  }

  const streak = learningState.streakCount;
  const answeredCount = questions.filter(isAnsweredToday).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  // Preference-aware exhausted copy (Wave 8 D4): strict preferences don't
  // borrow from the other tier — but we SAY so and point at the toggle.
  const prior = new Set(answeredKeysByDay.priorDays);
  const eligibleOtherTier =
    preference === LearningDifficulty.MIXED
      ? 0
      : bank.filter(
          (q) =>
            q.difficulty !== (preference === LearningDifficulty.BEGINNER ? 'Beginner' : 'Advanced') &&
            !prior.has(answeredKey(q.id, q.version)),
        ).length;

  const handleAnswer = async (q: TriviaQuestion, idx: number) => {
    if (isAnsweredToday(q)) return;
    // Fresh day read (not the hook's last tick) so an answer clicked seconds
    // past midnight records under the RIGHT day; the hook catches up within
    // a minute and re-partitions.
    const nowISO = localTodayISO();
    setChosenById((prev) => ({ ...prev, [q.id]: idx }));
    setFocusTarget('reveal');
    // ≥1-of-4 participation streak, folded into ONE store round (Wave 8):
    // nextStreak's idempotent same-day branch makes the 2nd/3rd/4th a no-op.
    await recordAnswer(
      {
        questionId: q.id,
        answeredIsoDate: nowISO,
        chosenIndex: idx,
        wasCorrect: idx === q.answerIndex,
        questionVersion: q.version,
      },
      {
        streakCount: nextStreak({
          current: streak,
          lastAnsweredISO: learningState.lastAnsweredIsoDate,
          todayISO: nowISO,
        }),
        lastAnsweredIsoDate: nowISO,
      },
    );
  };

  const goTo = (idx: number) => {
    setStepId(questions[idx].id);
    setFocusTarget('prompt');
  };

  return (
    <PageContainer width="prose" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Learn</h1>
          <p className="text-sm text-muted-foreground">
            A few questions a day to build financial vocabulary and intuition.
          </p>
          {answeredStats !== null && answeredStats.answered > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {answeredStats.answered} answered ·{' '}
              {Math.round((answeredStats.correct / answeredStats.answered) * 100)}% correct
            </p>
          )}
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
          title="Days in a row you've answered at least one question. Resets quietly if you miss a day."
        >
          <span className="font-semibold text-foreground">{streak}</span>-day streak
        </span>
      </div>

      <div className="flex justify-end">
        <PreferenceToggle
          value={preference}
          onChange={(v) => void updateLearning({ difficultyPreference: v })}
        />
      </div>

      <Card className="p-6 space-y-5">
        {questions.length === 0 || current === undefined ? (
          eligibleOtherTier > 0 ? (
            <EmptyState
              bare
              icon={GraduationCap}
              title={`You've answered every ${
                preference === LearningDifficulty.BEGINNER ? 'Basics' : 'Going-deeper'
              } question available`}
              description="Switch the difficulty above to keep going — or check back after an app update for new ones."
            />
          ) : (
            <EmptyState
              bare
              icon={GraduationCap}
              title="You've answered every question available"
              description="New questions ship with app updates — check back after your next update."
            />
          )
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <DifficultyBadge difficulty={current.difficulty} />
                <span className="text-xs text-muted-foreground">
                  Question {stepIndex + 1} of {questions.length}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous question"
                  disabled={stepIndex === 0}
                  onClick={() => goTo(stepIndex - 1)}
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next question"
                  disabled={stepIndex === questions.length - 1}
                  onClick={() => goTo(stepIndex + 1)}
                >
                  Next
                </Button>
              </div>
            </div>

            <section data-question-card className="space-y-3" aria-label={`Question ${stepIndex + 1} of ${questions.length}`}>
              {/* h2 under the page h1 (Wave 8 SHOULD-13 heading structure);
                  tabIndex -1 = the Back/Next focus target (D3). */}
              <h2 ref={promptRef} tabIndex={-1} className="text-base font-semibold outline-none">
                {current.prompt}
              </h2>
              {chosenFor(current) !== undefined ? (
                <GradedReveal question={current} chosenIndex={chosenFor(current)!} revealRef={revealRef} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {current.choices.map((choice, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void handleAnswer(current, i)}
                      className="flex w-full items-start gap-3 rounded-md border bg-background px-3.5 py-3 text-left text-sm hover:bg-accent"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-semibold text-muted-foreground">
                        {LETTERS[i]}
                      </span>
                      <span>{choice}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {allAnswered && (
              <div className="rounded-md border border-success/30 bg-success-soft p-4 text-center text-sm text-success-foreground">
                ✓ That's today's set — nice work. Come back tomorrow; your {streak}-day streak is
                safe.
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden>ⓘ</span> Educational — general financial-literacy content, not personalized advice.
        </div>
      </Card>
    </PageContainer>
  );
}

// The graded reveal — choices + verdict + explanation + citation. Renders
// for in-session answers AND rehydrated same-day answers (persisted
// chosen_index), so stepping back always shows the full grade (Wave 8 D2).
// role="status" (implicit polite live region) + tabIndex -1: answering both
// ANNOUNCES the verdict and receives focus (the old flow unmounted the
// focused button and said nothing — Wave 8 D3).
function GradedReveal({
  question,
  chosenIndex,
  revealRef,
}: {
  question: TriviaQuestion;
  chosenIndex: number;
  revealRef?: React.Ref<HTMLDivElement>;
}) {
  const wasCorrect = chosenIndex === question.answerIndex;
  const glossaryDisplay = question.glossaryTerm
    ? getGlossaryEntry(question.glossaryTerm)?.term ?? question.glossaryTerm
    : null;
  return (
    <div ref={revealRef} role="status" tabIndex={-1} className="space-y-3 outline-none">
      <div className="flex flex-col gap-2.5">
        {question.choices.map((choice, i) => {
          const isAnswer = i === question.answerIndex;
          const isChosen = i === chosenIndex;
          const cls = isAnswer
            ? 'border-success bg-success-soft'
            : isChosen
              ? 'border-destructive bg-destructive/10'
              : 'opacity-60';
          return (
            <div key={i} className={`flex w-full items-start gap-3 rounded-md border px-3.5 py-3 text-sm ${cls}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-semibold">
                {LETTERS[i]}
              </span>
              <span>{choice}</span>
              {isAnswer && (
                <span className="ml-auto text-success-foreground">
                  <span className="sr-only">Correct answer</span>
                  <span aria-hidden>✓</span>
                </span>
              )}
              {!isAnswer && isChosen && (
                <span className="ml-auto text-destructive-soft-foreground">
                  <span className="sr-only">Your answer</span>
                  <span aria-hidden>✕</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div
        className={`rounded-md border p-4 text-sm ${
          wasCorrect ? 'border-success/30 bg-success-soft' : 'border-destructive/30 bg-destructive/10'
        }`}
      >
        <div className={`mb-2 font-semibold ${wasCorrect ? 'text-success-foreground' : 'text-destructive-soft-foreground'}`}>
          {wasCorrect ? '✓ Correct' : `✕ Not quite — the answer is ${LETTERS[question.answerIndex]}`}
        </div>
        <p className="text-foreground/90">{question.explanation}</p>
        {question.glossaryTerm && (
          <p className="mt-2">
            <TermTooltip term={question.glossaryTerm}>Read more about {glossaryDisplay}</TermTooltip>
          </p>
        )}
        {/* T4 (Legal G2): version alongside source so a user can cite exactly
            which revision they saw. */}
        <p className="mt-2 text-xs text-muted-foreground">
          Source: {question.source} · question v{question.version}
        </p>
      </div>
    </div>
  );
}
