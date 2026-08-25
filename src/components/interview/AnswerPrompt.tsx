import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { FieldError } from '@/components/forms/form-errors';
import { useLocalToday } from '@/lib/use-local-today';
import { monthsBetweenIso } from '@/domain/interview/evaluate';
import type { AnswerSpec } from '@/types/interview';

interface Props {
  prompt: string;
  spec: AnswerSpec;
  onSubmit: (value: unknown) => Promise<void>;
}

const MONTH_OPTIONS = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
] as const;
// The HouseholdForm native-select classes, minus its flex/w-full (inline row):
const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Typed-control question prompt: enum → buttons, amount → MoneyInput +
 *  Save, amount-month-year → MoneyInput + native Month/Year selects + Save
 *  (the T2 compound arm; Save disabled until the amount is valid AND the
 *  month-year is ≥ 1 whole calendar month ahead — a past/current month
 *  with an amount entered explains the disable via the house aria trio:
 *  FieldError + aria-invalid + aria-describedby on the month/year group).
 *  Double-submit guard + inline error, per DecisionPrompt.
 *  ('amount-cadence' never reaches AnswerPrompt — the bar owns it.) */
export function AnswerPrompt({ prompt, spec, onSubmit }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const todayIso = useLocalToday(); // D-HP9: presentational clock only
  const monthErrorId = useId();

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
      {spec.kind === 'amount-month-year' && (() => {
        const currentYear = Number(todayIso.slice(0, 4));
        const years = Array.from({ length: 11 }, (_, i) => String(currentYear + i));
        const composed = month !== '' && year !== '' ? `${year}-${month}` : null;
        const future = composed != null && monthsBetweenIso(todayIso, `${composed}-01`) >= 1;
        const amountOk = draft != null && draft > 0 && draft <= (spec.maxDollars ?? 10_000_000);
        // Smoke a11y: the past/current-month rejection must not be silent.
        // With an amount entered and a full month-year selected that is not
        // ≥ 1 month ahead, say WHY Save is disabled (the house trio); an
        // incomplete selection is not an error, just not done yet.
        const monthInvalid = draft != null && composed != null && !future;
        return (
          <div className="space-y-1">
            <div className="flex gap-2 items-center flex-wrap">
              <div className="w-36">
                <MoneyInput aria-label="Amount" value={draft} onValueChange={setDraft} />
              </div>
              <select aria-label="Month" className={SELECT_CLASS} value={month}
                aria-invalid={monthInvalid || undefined}
                aria-describedby={monthInvalid ? monthErrorId : undefined}
                onChange={(e) => setMonth(e.target.value)}>
                <option value="">Month</option>
                {MONTH_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <select aria-label="Year" className={SELECT_CLASS} value={year}
                aria-invalid={monthInvalid || undefined}
                aria-describedby={monthInvalid ? monthErrorId : undefined}
                onChange={(e) => setYear(e.target.value)}>
                <option value="">Year</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <Button size="sm" variant="outline"
                disabled={submitting || !amountOk || !future}
                onClick={() => submit({ amountDollars: draft, targetMonth: composed })}>
                Save
              </Button>
            </div>
            <FieldError id={monthErrorId}
              message={monthInvalid ? 'Pick a month at least one month ahead.' : undefined} />
          </div>
        );
      })()}
      {error && (
        <div className="text-xs text-destructive-soft-foreground" role="alert">{error}</div>
      )}
    </div>
  );
}
