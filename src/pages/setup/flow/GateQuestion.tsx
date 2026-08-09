import { type ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/forms/form-errors';
import type { StepStatus } from '@/lib/setup-progress';

interface Props {
  idPrefix: string;              // stable control ids, e.g. 'gate-loans'
  question: string;              // CW-30
  consequence: string;           // CW-31 — renders when the answer is No
  intro?: ReactNode;             // CW-32 loans sentence / CW-21 HOH lead
  entityCount: number;
  nounSingular: string;
  nounPlural: string;
  storedStatus: StepStatus;
  answer: 'yes' | 'no' | null;   // local step state, seeded by the parent
  /** The RECORDED literal answer (progress.gateAnswers) — review M2: the
   *  "You said …" hints render ONLY from this, never from a status DERIVED
   *  by a form-view Section action. */
  literalAnswer: 'yes' | 'no' | null;
  onAnswer: (a: 'yes' | 'no') => void;
  /** CW-34 override for the import gate; defaults to the standard template. */
  changedYourMindText?: string;
  /** Review m2: an attempted Next without an answer renders the required
   *  message, wired to the radiogroup. */
  showRequiredError?: boolean;
  /** Inline cards — rendered when the EFFECTIVE answer is yes. */
  children?: ReactNode;
  extraNote?: ReactNode;         // CW-21 HOH "no" note etc.
}

export default function GateQuestion(p: Props) {
  // Gate honesty: with data present the control reflects the DATA.
  const effectiveAnswer = p.entityCount > 0 ? 'yes' : p.answer;
  const skippedWithData = p.storedStatus === 'skipped' && p.entityCount > 0;
  // M2: attribution hints key on the LITERAL recorded answer only — a
  // derived status renders the gate unanswered with no hint.
  const changedYourMind = p.literalAnswer === 'no' && p.entityCount === 0;
  const yesWithZero = p.literalAnswer === 'yes' && p.entityCount === 0;
  const noun = p.entityCount === 1 ? p.nounSingular : p.nounPlural;
  return (
    <div className="space-y-3">
      {p.intro}
      <p className="text-base font-medium" id={`${p.idPrefix}-q`}>{p.question}</p>
      {skippedWithData && (
        <p className="text-sm text-muted-foreground" role="note">
          {p.entityCount === 1
            ? `Recorded as skipped earlier — 1 ${noun} exists.`
            : `Recorded as skipped earlier — ${p.entityCount} ${noun} exist.`}
        </p>
      )}
      {changedYourMind && (
        <p className="text-sm text-muted-foreground" role="note">
          {p.changedYourMindText ?? `You said no ${p.nounPlural} earlier — changed your mind?`}
        </p>
      )}
      {yesWithZero && (
        <p className="text-sm text-muted-foreground" role="note">
          You said yes earlier — nothing has been added yet.
        </p>
      )}
      <RadioGroup
        aria-labelledby={`${p.idPrefix}-q`}
        aria-invalid={p.showRequiredError ? true : undefined}
        aria-describedby={p.showRequiredError ? `${p.idPrefix}-required-error` : undefined}
        value={effectiveAnswer ?? ''}
        onValueChange={(v) => p.onAnswer(v as 'yes' | 'no')}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="yes" id={`${p.idPrefix}-yes`} />
          <Label htmlFor={`${p.idPrefix}-yes`}>Yes</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id={`${p.idPrefix}-no`} />
          <Label htmlFor={`${p.idPrefix}-no`}>No</Label>
        </div>
      </RadioGroup>
      {p.showRequiredError && (
        <FieldError id={`${p.idPrefix}-required-error`} message="An answer is required." />
      )}
      {effectiveAnswer === 'no' && (
        <p className="text-sm text-muted-foreground">{p.consequence}</p>
      )}
      {p.extraNote}
      {effectiveAnswer === 'yes' && p.children}
    </div>
  );
}
