import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailyQuestion, nextStreak, localTodayISO } from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import { LearningDifficulty } from '@/types/enums';
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
  const answeredQuestionIds = useLearningStore((s) => s.answeredQuestionIds);
  const loadLearning = useLearningStore((s) => s.load);
  const updateLearning = useLearningStore((s) => s.update);
  const recordAnswer = useLearningStore((s) => s.recordAnswer);
  // The acceptances store is boot-loaded by AppDisclaimerGate for the whole
  // app; this page MUST NOT call load() itself. It renders below the gate, and
  // re-loading the shared store flips it to 'loading', which makes the gate
  // unmount/remount this page in a loop. We only READ the status below.
  // Backend #4: self-guard a cold deep-link against flashing content before the
  // acceptances projection resolves (defense-in-depth; the router-level
  // AppDisclaimerGate already gates, but /learn must not assume it ran first).
  const acceptancesStatus = useAcceptancesStore((s) => s.status);

  const [bank, setBank] = useState<TriviaQuestion[] | null>(null);
  const [bankError, setBankError] = useState(false);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const todayISO = useMemo(() => localTodayISO(), []);

  useEffect(() => {
    void loadHousehold();
    void loadLearning();
    // SEC-1: loadTriviaBank THROWS on a malformed/duplicate-id bank; catch it
    // so a corrupt bank surfaces as the calm "couldn't load" state below, never
    // an unhandled rejection that leaves bank=null and mis-renders as "you've
    // completed every question".
    loadTriviaBank().then(
      (b) => setBank(b),
      () => setBankError(true),
    );
  }, [loadHousehold, loadLearning]);

  const difficulty = learningState?.difficultyPreference ?? LearningDifficulty.BEGINNER;

  const question = useMemo(() => {
    if (!bank || !learningState) return null;
    return selectDailyQuestion({
      bank,
      answeredIds: answeredQuestionIds,
      difficulty,
      todayISO,
      state: {
        lastShownIsoDate: learningState.lastShownIsoDate,
        lastShownQuestionId: learningState.lastShownQuestionId,
      },
    });
  }, [bank, learningState, answeredQuestionIds, difficulty, todayISO]);

  // Persist the day's pinned question so it stays stable until tomorrow.
  useEffect(() => {
    if (!question || !learningState) return;
    if (learningState.lastShownIsoDate === todayISO && learningState.lastShownQuestionId === question.id) {
      return;
    }
    void updateLearning({ lastShownQuestionId: question.id, lastShownIsoDate: todayISO });
  }, [question, learningState, todayISO, updateLearning]);

  // Version-aware: "answered today" means THIS (id, version) is in the set, so
  // a corrected/bumped question is treated as unanswered and re-prompts (TR-3).
  const answeredToday = question ? answeredQuestionIds.includes(answeredKey(question.id, question.version)) : false;

  if (!household) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="text-sm text-muted-foreground">Set up your household to start learning.</div>
      </div>
    );
  }

  // Backend #4: while the acceptances projection is still loading, render a calm
  // placeholder — NOT the question — so a cold deep-link to /learn can't flash
  // gated content for the frame before the gate resolves. (The router-level
  // AppDisclaimerGate covers the app_wide case; this is the learning-gate's own
  // defense-in-depth.)
  if (acceptancesStatus === 'loading') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
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

  // SEC-1: the bank failed to load/validate. Show a calm, honest error state
  // rather than the empty "you've completed every question" message (which
  // bank=null would otherwise trigger downstream).
  if (bankError) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-2xl font-semibold">Learn</h1>
          <p className="text-sm text-muted-foreground">
            We couldn't load today's question. Please refresh, or try again later.
          </p>
        </Card>
      </div>
    );
  }

  const streak = learningState?.streakCount ?? 0;

  const handleAnswer = async (idx: number) => {
    if (!question || answeredToday) return;
    setChosenIndex(idx);
    const wasCorrect = idx === question.answerIndex;
    await recordAnswer({
      questionId: question.id,
      answeredIsoDate: todayISO,
      chosenIndex: idx,
      wasCorrect,
      questionVersion: question.version,
    });
    await updateLearning({
      streakCount: nextStreak({
        current: streak,
        lastAnsweredISO: learningState?.lastAnsweredIsoDate ?? null,
        todayISO,
      }),
      lastAnsweredIsoDate: todayISO,
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      {/* UX S1: page-level title OUTSIDE the Card (text-2xl), matching every
          other page (Roadmap/What-If + the new paycheck/backtest detail
          headers). The streak chip rides the header row, right-aligned. */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Learn</h1>
          <p className="text-sm text-muted-foreground">
            One question a day to build financial vocabulary and intuition.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
          title="Days in a row you've answered. Resets quietly if you miss a few."
        >
          <span className="font-semibold text-foreground">{streak}</span>-day streak
        </span>
      </div>

      <Card className="p-6 space-y-5">
        {!question ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            You've completed every question in this tier — new ones ship with each update. Try
            switching difficulty in Settings.
          </div>
        ) : chosenIndex !== null ? (
          // In-session graded reveal — shown only while chosenIndex is set
          // (i.e. the user just answered this session). chosenIndex is
          // ephemeral React state and is NEVER rehydrated from the DB, so on a
          // later same-day visit it is null and we fall through to the calm
          // done-state below — never this graded view, which would mis-grade a
          // null pick as wrong (null === answerIndex → "Not quite").
          <AnsweredView question={question} chosenIndex={chosenIndex} streak={streak} />
        ) : answeredToday ? (
          // Revisit after answering in a prior session (refresh / re-nav /
          // restart): calm done-state, matching TodaysTriviaCard + mockup
          // state D. No chosenIndex/wasCorrect dependence, so a correct answer
          // can never be shown as "Not quite".
          <AnsweredDoneView streak={streak} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <DifficultyBadge difficulty={question.difficulty} />
              {question.tags.length > 0 && (
                <span className="text-xs text-muted-foreground">{question.tags.join(' · ')}</span>
              )}
            </div>
            <p className="text-lg font-semibold">{question.prompt}</p>
            <div className="flex flex-col gap-2.5">
              {question.choices.map((choice, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void handleAnswer(i)}
                  className="flex w-full items-start gap-3 rounded-md border bg-background px-3.5 py-3 text-left text-sm hover:bg-accent"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-semibold text-muted-foreground">
                    {LETTERS[i]}
                  </span>
                  <span>{choice}</span>
                </button>
              ))}
            </div>
          </div>
        ) }

        {/* Difficulty preference (also in Settings; mirrored here per the mockup). */}
        <div className="border-t pt-4">
          <div className="text-sm font-medium">Difficulty</div>
          <p className="text-xs text-muted-foreground mb-2">
            Also in Settings. Changing it takes effect tomorrow — today's question stays put.
          </p>
          <div className="inline-flex overflow-hidden rounded-md border">
            {(Object.values(LearningDifficulty) as LearningDifficulty[]).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={difficulty === d}
                onClick={() => void updateLearning({ difficultyPreference: d })}
                className={`border-r px-4 py-1.5 text-sm last:border-r-0 ${
                  difficulty === d ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden>ⓘ</span> Educational — general financial-literacy content, not personalized advice.
        </div>
      </Card>
    </div>
  );
}

function AnsweredView({
  question,
  chosenIndex,
  streak,
}: {
  question: TriviaQuestion;
  chosenIndex: number | null;
  streak: number;
}) {
  const wasCorrect = chosenIndex === question.answerIndex;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DifficultyBadge difficulty={question.difficulty} />
        {question.tags.length > 0 && (
          <span className="text-xs text-muted-foreground">{question.tags.join(' · ')}</span>
        )}
      </div>
      <p className="text-lg font-semibold">{question.prompt}</p>
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
            user can cite exactly which version they saw if they spot an error
            (the recorded question_version backs the v1.2 correction re-prompt). */}
        <p className="mt-2 text-xs text-muted-foreground">
          Source: {question.source} · question v{question.version}
        </p>
      </div>
      <div className="text-xs text-muted-foreground">
        That's today's question. Come back tomorrow — no rush; your {streak}-day streak is safe.
      </div>
    </div>
  );
}

// Calm done-state for a same-day revisit (mockup state D + TodaysTriviaCard).
// Deliberately has NO chosenIndex/wasCorrect dependence: the graded reveal is
// an in-session reward only, so a later visit simply confirms today is done and
// can never mis-render a correct answer as "Not quite".
function AnsweredDoneView({ streak }: { streak: number }) {
  return (
    <div className="rounded-md border border-success/30 bg-success-soft p-6 text-center">
      <div className="text-2xl text-success-foreground" aria-hidden>
        ✓
      </div>
      <div className="mt-1 font-semibold text-success-foreground">That's today's question</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Nice work — you've answered today. Come back tomorrow for the next one. No rush; your{' '}
        {streak}-day streak is safe.
      </p>
    </div>
  );
}
