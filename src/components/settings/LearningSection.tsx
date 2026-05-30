import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLearningStore } from '@/stores/learning-state-store';
import { LearningDifficulty } from '@/types/enums';

/**
 * Settings → Learning. The daily-trivia difficulty preference. Persists on
 * learning_state; a mid-day change takes effect tomorrow (today's question is
 * pinned by the daily selector — anti-gaming). The same control is mirrored
 * inline on /learn per the mockup. See spec §10.1.
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
          Difficulty of the daily question on the Learn page. Changing it takes effect tomorrow —
          today's question stays put.
        </p>
        <div className="inline-flex overflow-hidden rounded-md border">
          {(Object.values(LearningDifficulty) as LearningDifficulty[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              disabled={learningState === null}
              onClick={() => void update({ difficultyPreference: d })}
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
