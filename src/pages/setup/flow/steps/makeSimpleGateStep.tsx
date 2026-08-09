import { type ComponentType } from 'react';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { type GateStepId } from '@/domain/setup-flow/engine';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/**
 * Card-less gate step: question, honesty notes, restorable yes/no, D-WF11
 * statuses via the shell. Tasks 8–9 swapped the nine gates onto card-bearing
 * steps; the factory remains for any future cardless gate. GATE_CONFIG
 * access is render-time only, so the registry↔factory import cycle never
 * dereferences a half-initialized binding.
 */
export function makeSimpleGateStep(id: GateStepId): ComponentType<StepComponentProps> {
  function SimpleGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
    const { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError } = useGateAnswer(
      id, ctx, submitRef, onDirtyChange,
    );
    const cfg = GATE_CONFIG[id];
    return (
      <GateQuestion
        idPrefix={`gate-${id}`}
        question={cfg.question}
        consequence={cfg.consequence}
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        literalAnswer={literalAnswer}
        showRequiredError={requiredError}
        onAnswer={setAnswer}
        changedYourMindText={cfg.changedYourMindText}
      />
    );
  }
  SimpleGateStep.displayName = `SimpleGateStep(${id})`;
  return SimpleGateStep;
}
