import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import type { AnswerSpec } from '@/types/interview';

interface Props {
  prompt: string;
  spec: AnswerSpec;
  onSubmit: (value: unknown) => Promise<void>;
}

/** Typed-control question prompt: enum → buttons, amount → MoneyInput +
 *  Save. Double-submit guard + inline error, per DecisionPrompt.
 *  ('amount-cadence' never reaches AnswerPrompt — the bar owns it.) */
export function AnswerPrompt({ prompt, spec, onSubmit }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

  const submit = async (value: unknown) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="text-xs text-foreground">{prompt}</div>
      {spec.kind === 'enum' && (
        <div className="flex gap-2 flex-wrap">
          {spec.options.map((o) => (
            <Button key={o.value} size="sm" variant="outline" disabled={submitting} onClick={() => submit(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
      {spec.kind === 'amount' && (
        <div className="flex gap-2 items-center">
          <div className="w-36">
            <MoneyInput aria-label="Amount" value={draft} onValueChange={setDraft} />
          </div>
          <Button size="sm" variant="outline"
            disabled={submitting || draft == null || draft <= 0 || draft > (spec.maxDollars ?? 10_000_000)}
            onClick={() => submit(draft)}>
            Save
          </Button>
        </div>
      )}
      {error && (
        <div className="text-xs text-destructive-soft-foreground" role="alert">{error}</div>
      )}
    </div>
  );
}
