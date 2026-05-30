import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailyQuestion, localTodayISO } from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import { LearningDifficulty } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

/**
 * Compact Dashboard widget — the primary daily touchpoint for the trivia
 * feature. Reuses the NextMoveCard shape (Card p-4, uppercase eyebrow with a
 * right View link, soft tint by state, underlined CTA). It never renders a
 * modal: when the learning disclosure is unaccepted it shows an in-card CTA
 * to /learn (where the modal lives). See spec §10.2.
 */
export function TodaysTriviaCard() {
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const gate = useDisclosureGate('learning');
  // MF-1: the gate reads the acceptances store; load it so a Dashboard-only
  // render has a hydrated gate (idempotent; AppDisclaimerGate also boot-loads it).
  const loadAcceptances = useAcceptancesStore((s) => s.load);

  const learningState = useLearningStore((s) => s.learningState);
  const answeredQuestionIds = useLearningStore((s) => s.answeredQuestionIds);
  const loadLearning = useLearningStore((s) => s.load);

  const [bank, setBank] = useState<TriviaQuestion[] | null>(null);
  const todayISO = useMemo(() => localTodayISO(), []);

  useEffect(() => {
    void loadHousehold();
    void loadAcceptances();
    void loadLearning();
    void loadTriviaBank().then(setBank);
  }, [loadHousehold, loadAcceptances, loadLearning]);

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

  // Finish-setup affordance (mirrors NextMoveCard household-null branch).
  if (!household) {
    return (
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Today's question</div>
        <div className="mt-1 text-sm text-foreground">Finish setting up to start learning.</div>
        <Link to="/setup" className="mt-2 inline-block text-sm text-info-foreground underline">
          Continue Setup →
        </Link>
      </Card>
    );
  }

  // Disclosure not accepted — in-card CTA, NOT a modal.
  if (gate.state === 'needs-acceptance') {
    return (
      <Card className="p-4 bg-info-soft border-info/30">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-info-foreground">
          <span>Today's question</span>
          <Link to="/learn" className="text-xs underline">View →</Link>
        </div>
        <div className="mt-1 text-sm font-medium">Start daily learning</div>
        <Link to="/learn" className="mt-2 inline-block text-sm text-info-foreground underline">
          Open Learn →
        </Link>
      </Card>
    );
  }

  // Bank is still loading — render a minimal placeholder that does NOT show
  // "Today's question" eyebrow so the consumer doesn't flash a misleading state
  // while the JSON chunk loads (typically < 100 ms).
  if (!bank) return <Card className="p-4" aria-busy="true" />;


  // Version-aware: "answered today" means THIS (id, version) is in the set, so
  // a corrected/bumped question is treated as unanswered and re-prompts (TR-3).
  const answeredToday = question ? answeredQuestionIds.includes(answeredKey(question.id, question.version)) : false;
  const streak = learningState?.streakCount ?? 0;

  if (answeredToday || !question) {
    return (
      <Card className="p-4 bg-success-soft border-success/30">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-success-foreground">
          <span>Today's question</span>
          <Link to="/learn" className="text-xs underline">View →</Link>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-success-foreground">
          ✓ Answered today
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">Come back tomorrow for the next one.</div>
        <div className="mt-2 text-xs text-muted-foreground">{streak}-day streak</div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-info-soft border-info/30">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-info-foreground">
        <span>Today's question</span>
        <Link to="/learn" className="text-xs underline">View →</Link>
      </div>
      <div className="mt-2 inline-block rounded-full border border-info/30 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info-foreground">
        {question.difficulty}
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-foreground">{question.prompt}</p>
      <Link to="/learn" className="mt-3 inline-block text-sm font-medium text-info-foreground underline">
        Answer →
      </Link>
    </Card>
  );
}

export default TodaysTriviaCard;
