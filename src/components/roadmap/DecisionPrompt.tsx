import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { NodeQuestion } from '@/types/roadmap';

interface Props {
  question: NodeQuestion;
}

/**
 * Inline answer widget rendered under an `unanswered` node row. Renders
 * Yes/No buttons for `yes-no` questions and the supplied option list
 * for `enum` questions. Clicking a button invokes the rule's
 * `onAnswer(value)` callback, which writes through the relevant store —
 * the rule engine picks up the change on the next render.
 *
 * Local `submitting` flag disables the buttons during the async write so
 * a double-click doesn't fire two updates. Failures bubble out of
 * `onAnswer` so the surrounding store layer can surface them; we render
 * a small inline error so the user can retry.
 */
export function DecisionPrompt({ question }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options =
    question.answerType === 'yes-no'
      ? [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]
      : question.options ?? [];

  const handleClick = async (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await question.onAnswer(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="text-xs text-slate-700">{question.prompt}</div>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() => handleClick(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {error && (
        <div className="text-xs text-destructive" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default DecisionPrompt;
