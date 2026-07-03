import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
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
import { answeredKey } from '@/lib/trivia/answered-key';
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

export default function Learn() {
  const navigate = useNavigate();
  const gate = useDisclosureGate('learning');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);

  const learningState = useLearningStore((s) => s.learningState);
  const answeredKeysByDay = useLearningStore((s) => s.answeredKeysByDay);
  const loadLearning = useLearningStore((s) => s.load);
  const updateLearning = useLearningStore((s) => s.update);
  const recordAnswer = useLearningStore((s) => s.recordAnswer);
  // The acceptances store is boot-loaded by AppDisclaimerGate for the whole
  // app; this page MUST NOT call load() itself. It renders below the gate, and
  // re-loading the shared store flips it to 'loading', which makes the gate
  // unmount/remount this page in a loop. We only READ the status below.
  const acceptancesStatus = useAcceptancesStore((s) => s.status);

  const [bank, setBank] = useState<TriviaQuestion[] | null>(null);
  const [bankError, setBankError] = useState(false);
  // Per-question chosen index for the in-session graded reveal. Ephemeral React
  // state, NEVER rehydrated from the DB — so a later same-day visit shows the
  // calm done-state per card, never a mis-graded null pick.
  const [chosenById, setChosenById] = useState<Record<string, number>>({});
  const todayISO = useMemo(() => localTodayISO(), []);

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

  // The day's 4-set (2 Beginner + 2 Advanced), derived purely from the reviewed
  // pool + the date-partitioned answered set (§3.0). Prior-day answers are
  // excluded; today's stay in the set (shown graded). No per-question pin column.
  const questions = useMemo(() => {
    if (!bank || !learningState) return [];
    return selectDailySet({
      bank,
      answeredIds: answeredKeysByDay.priorDays,
      answeredTodayIds: answeredKeysByDay.today,
      todayISO,
    });
  }, [bank, learningState, answeredKeysByDay, todayISO]);

  // Mark "seen today" once (a single lastShownIsoDate write; lastShownQuestionId
  // is deprecated under the derive anchor — set to null, no per-question pin).
  useEffect(() => {
    if (questions.length === 0 || !learningState) return;
    if (learningState.lastShownIsoDate === todayISO) return;
    void updateLearning({ lastShownIsoDate: todayISO, lastShownQuestionId: null });
  }, [questions, learningState, todayISO, updateLearning]);

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
  // placeholder — NOT the questions — so a cold deep-link can't flash gated
  // content for the frame before the gate resolves.
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

  // SEC-1: the bank failed to load/validate. Calm, honest error state.
  if (bankError) {
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

  const streak = learningState?.streakCount ?? 0;
  const todaySet = new Set(answeredKeysByDay.today);
  const isAnsweredToday = (q: TriviaQuestion) => todaySet.has(answeredKey(q.id, q.version));
  const answeredCount = questions.filter(isAnsweredToday).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  const handleAnswer = async (q: TriviaQuestion, idx: number) => {
    if (isAnsweredToday(q) || chosenById[q.id] !== undefined) return;
    setChosenById((prev) => ({ ...prev, [q.id]: idx }));
    const wasCorrect = idx === q.answerIndex;
    // recordAnswer reloads the store → answeredKeysByDay.today gains this key.
    await recordAnswer({
      questionId: q.id,
      answeredIsoDate: todayISO,
      chosenIndex: idx,
      wasCorrect,
      questionVersion: q.version,
    });
    // ≥1-of-4: only the FIRST answer of the day moves the streak; the idempotent
    // same-day branch in nextStreak makes the 2nd/3rd/4th a no-op.
    await updateLearning({
      streakCount: nextStreak({
        current: streak,
        lastAnsweredISO: learningState?.lastAnsweredIsoDate ?? null,
        todayISO,
      }),
      lastAnsweredIsoDate: todayISO,
    });
  };

  const beginnerQs = questions.filter((q) => q.difficulty === 'Beginner');
  const advancedQs = questions.filter((q) => q.difficulty === 'Advanced');

  const renderCard = (q: TriviaQuestion) => {
    const chosen = chosenById[q.id];
    const answeredInSession = chosen !== undefined;
    const answeredPrior = isAnsweredToday(q) && !answeredInSession;
    return (
      <div key={q.id} data-question-card className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <DifficultyBadge difficulty={q.difficulty} />
        </div>
        <p className="text-base font-semibold">{q.prompt}</p>
        {answeredInSession ? (
          <GradedReveal question={q} chosenIndex={chosen} />
        ) : answeredPrior ? (
          <div className="rounded-md border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success-foreground">
            ✓ Answered today
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {q.choices.map((choice, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void handleAnswer(q, i)}
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
      </div>
    );
  };

  return (
    <PageContainer width="prose" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Learn</h1>
          <p className="text-sm text-muted-foreground">
            A few questions a day to build financial vocabulary and intuition.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
          title="Days in a row you've answered. Resets quietly if you miss a few."
        >
          <span className="font-semibold text-foreground">{streak}</span>-day streak
        </span>
      </div>

      <Card className="p-6 space-y-6">
        {questions.length === 0 ? (
          <EmptyState
            bare
            icon={GraduationCap}
            title="You've answered every question available"
            description="New ones ship with each update. Come back tomorrow."
          />
        ) : (
          <>
            {beginnerQs.length > 0 && (
              <section className="space-y-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Basics</div>
                {beginnerQs.map(renderCard)}
              </section>
            )}
            {advancedQs.length > 0 && (
              <section className="space-y-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Going deeper
                </div>
                {advancedQs.map(renderCard)}
              </section>
            )}
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

// Per-question in-session graded reveal (the choices + verdict + explanation).
function GradedReveal({ question, chosenIndex }: { question: TriviaQuestion; chosenIndex: number }) {
  const wasCorrect = chosenIndex === question.answerIndex;
  return (
    <div className="space-y-3">
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
              {isAnswer && <span className="ml-auto text-success-foreground">✓</span>}
              {!isAnswer && isChosen && <span className="ml-auto text-destructive-soft-foreground">✕</span>}
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
            <TermTooltip term={question.glossaryTerm}>Read more about {question.glossaryTerm}</TermTooltip>
          </p>
        )}
        {/* T4 (Legal G2): show the question version alongside the source so a
            user can cite exactly which version they saw if they spot an error. */}
        <p className="mt-2 text-xs text-muted-foreground">
          Source: {question.source} · question v{question.version}
        </p>
      </div>
    </div>
  );
}
