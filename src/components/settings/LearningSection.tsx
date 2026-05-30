import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLearningStore } from '@/stores/learning-state-store';
import { LearningDifficulty } from '@/types/enums';
import { localTodayISO } from '@/lib/trivia/daily';

/**
 * Settings → Learning. The daily-trivia difficulty preference. Persists on
 * learning_state. Changing it swaps today's question to the new level — unless
 * today's has already been answered, in which case today's is locked and the
 * change applies to tomorrow's question. (Clearing the shown-question pin lets
 * the daily selector on /learn re-roll for the new difficulty.) The same control
 * is mirrored inline on /learn. See spec §10.1.
 */
export function LearningSection() {
  const learningState = useLearningStore((s) => s.learningState);
  const load = useLearningStore((s) => s.load);
  const update = useLearningStore((s) => s.update);

  useEffect(() => {
    void load();
  }, [load]);

  const difficulty = learningState?.difficultyPreference ?? LearningDifficulty.BEGINNER;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Difficulty of the daily question on the Learn page. Switches today's question to the new
          level — until you've answered today's.
        </p>
        <div className="inline-flex overflow-hidden rounded-md border">
          {(Object.values(LearningDifficulty) as LearningDifficulty[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              disabled={learningState === null}
              onClick={() =>
                void update({
                  difficultyPreference: d,
                  // Swap today's question unless it's already been answered today
                  // (then today's is locked; the change applies tomorrow).
                  ...(learningState?.lastAnsweredIsoDate === localTodayISO()
                    ? {}
                    : { lastShownQuestionId: null }),
                })
              }
              className={`border-r px-4 py-1.5 text-sm last:border-r-0 ${
                difficulty === d ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default LearningSection;
