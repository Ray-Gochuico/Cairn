import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailySet, localTodayISO } from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

/**
 * Compact Dashboard widget — the primary daily touchpoint for the trivia
 * feature. Reuses the NextMoveCard shape (Card p-4, uppercase eyebrow with a
 * right View link, soft tint by state, underlined CTA). It never renders a
 * modal: when the learning disclosure is unaccepted it shows an in-card CTA
 * to /learn (where the modal lives). See spec §10.2.
 *
 * Learning v2 (L1.4): the daily set is now 4 (2 Beginner + 2 Advanced), so the
 * card summarizes progress — "{answeredCount} of {n} answered" with a
 * Start/Continue/Done CTA — instead of a single question + Answer link.
 */
export function TodaysTriviaCard() {
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  // The gate reads the acceptances store, which AppDisclaimerGate boot-loads
  // for the whole app. This widget MUST NOT call load() itself: it renders
  // below the gate, and re-loading the shared store flips it to 'loading',
  // which makes the gate unmount/remount this widget in a loop.
  const gate = useDisclosureGate('learning');

  const learningState = useLearningStore((s) => s.learningState);
  const answeredKeysByDay = useLearningStore((s) => s.answeredKeysByDay);
  const loadLearning = useLearningStore((s) => s.load);

  const [bank, setBank] = useState<TriviaQuestion[] | null>(null);
  const todayISO = useMemo(() => localTodayISO(), []);

  useEffect(() => {
    void loadHousehold();
    void loadLearning();
    // SEC-1: loadTriviaBank rejects on a malformed/duplicate-id bank. Swallow
    // it so the widget degrades to its calm aria-busy placeholder (bank stays
    // null → the !bank guard) instead of an unhandled rejection. The /learn
    // page owns the explicit "couldn't load" error state.
    void loadTriviaBank().then(setBank, () => {});
  }, [loadHousehold, loadLearning]);

  const questions = useMemo(() => {
    if (!bank || !learningState) return [];
    return selectDailySet({
      bank,
      answeredIds: answeredKeysByDay.priorDays,
      answeredTodayIds: answeredKeysByDay.today,
      todayISO,
    });
  }, [bank, learningState, answeredKeysByDay, todayISO]);

  // Finish-setup affordance (mirrors NextMoveCard household-null branch).
  if (!household) {
    return (
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Today's questions</div>
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
          <span>Today's questions</span>
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
  // the eyebrow so the consumer doesn't flash a misleading state while the JSON
  // chunk loads (typically < 100 ms).
  if (!bank) return <Card className="p-4" aria-busy="true" />;

  const todaySet = new Set(answeredKeysByDay.today);
  const answeredCount = questions.filter((q) => todaySet.has(answeredKey(q.id, q.version))).length;
  const total = questions.length;
  const streak = learningState?.streakCount ?? 0;
  const allDone = total > 0 && answeredCount === total;

  if (allDone) {
    return (
      <Card className="p-4 bg-success-soft border-success/30">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-success-foreground">
          <span>Today's questions</span>
          <Link to="/learn" className="text-xs underline">View →</Link>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-success-foreground">
          ✓ Done — {answeredCount} of {total} answered
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">Come back tomorrow for the next set.</div>
        <div className="mt-2 text-xs text-muted-foreground">{streak}-day streak</div>
      </Card>
    );
  }

  const started = answeredCount > 0;
  return (
    <Card className="p-4 bg-info-soft border-info/30">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-info-foreground">
        <span>Today's questions</span>
        <Link to="/learn" className="text-xs underline">View →</Link>
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">
        {answeredCount} of {total} answered
      </p>
      <div className="mt-0.5 text-xs text-muted-foreground">
        A mix of Basics and Going-deeper questions.
      </div>
      <Link to="/learn" className="mt-3 inline-block text-sm font-medium text-info-foreground underline">
        {started ? 'Continue →' : 'Start →'}
      </Link>
    </Card>
  );
}

export default TodaysTriviaCard;
