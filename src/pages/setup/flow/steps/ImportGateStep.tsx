import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** import_gate — Yes renders the shared Section 4 importer; the CW-34
 *  variant comes from GATE_CONFIG's changedYourMindText. */
export default function ImportGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, entityCount } = useGateAnswer(
    'import_gate', ctx, submitRef, onDirtyChange,
  );
  const cfg = GATE_CONFIG.import_gate;
  return (
    <GateQuestion
      idPrefix="gate-import"
      question={cfg.question}
      consequence={cfg.consequence}
      entityCount={entityCount}
      nounSingular={cfg.nounSingular}
      nounPlural={cfg.nounPlural}
      storedStatus={storedStatus}
      answer={answer}
      onAnswer={setAnswer}
      changedYourMindText={cfg.changedYourMindText}
    >
      <TransactionsSectionImporter />
    </GateQuestion>
  );
}
