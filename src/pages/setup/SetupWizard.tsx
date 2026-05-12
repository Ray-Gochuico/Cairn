import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Step1Household from './Step1Household';
import Step2Persons from './Step2Persons';
import Step3Dependents from './Step3Dependents';
import Step4Accounts from './Step4Accounts';
import Step5Holdings from './Step5Holdings';
import Step6Loans from './Step6Loans';
import Step7PropertyVehicles from './Step7PropertyVehicles';

type StepIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface StepMeta {
  index: StepIndex;
  label: string;
}

const STEPS: StepMeta[] = [
  { index: 1, label: 'Household' },
  { index: 2, label: 'Persons' },
  { index: 3, label: 'Dependents' },
  { index: 4, label: 'Accounts' },
  { index: 5, label: 'Holdings' },
  { index: 6, label: 'Loans' },
  { index: 7, label: 'Property & Vehicles' },
  { index: 8, label: 'Goals' },
];

function PlaceholderStep({
  index,
  onComplete,
}: {
  index: StepIndex;
  onComplete: () => void;
}) {
  return (
    <div className="border rounded-md p-8 text-center space-y-3">
      <p className="text-muted-foreground">Step {index}: (Unit I)</p>
      <p className="text-sm text-muted-foreground">
        This step will be wired in a later unit. Use Next to skip ahead.
      </p>
      <Button type="button" onClick={onComplete}>
        Next
      </Button>
    </div>
  );
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState<StepIndex>(1);
  const [completed, setCompleted] = useState<Set<StepIndex>>(new Set());

  const advance = () => {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(current);
      return next;
    });
    if (current < 8) {
      setCurrent((current + 1) as StepIndex);
    }
  };

  const goBack = () => {
    if (current > 1) {
      setCurrent((current - 1) as StepIndex);
    }
  };

  const finish = () => {
    navigate('/');
  };

  const currentMeta = STEPS[current - 1];

  let stepContent: React.ReactNode;
  switch (current) {
    case 1:
      stepContent = <Step1Household onComplete={advance} />;
      break;
    case 2:
      stepContent = <Step2Persons onComplete={advance} />;
      break;
    case 3:
      stepContent = <Step3Dependents onComplete={advance} />;
      break;
    case 4:
      stepContent = <Step4Accounts onComplete={advance} />;
      break;
    case 5:
      stepContent = <Step5Holdings onComplete={advance} />;
      break;
    case 6:
      stepContent = <Step6Loans onComplete={advance} />;
      break;
    case 7:
      stepContent = <Step7PropertyVehicles onComplete={advance} />;
      break;
    default:
      stepContent = <PlaceholderStep index={current} onComplete={advance} />;
  }

  const isLast = current === 8;
  const stepDone = completed.has(current);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">Welcome — let&apos;s set up your household</h1>
          <p className="text-sm text-muted-foreground">
            Step {current} of 8: {currentMeta.label}
          </p>
        </div>
      </header>

      <nav className="border-b">
        <ol className="max-w-3xl mx-auto px-6 py-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {STEPS.map((s) => {
            const isCurrent = s.index === current;
            const isDone = completed.has(s.index);
            return (
              <li
                key={s.index}
                className={
                  isCurrent
                    ? 'font-semibold text-foreground'
                    : isDone
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/60'
                }
              >
                {s.index}. {s.label}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">{stepContent}</div>
      </main>

      <footer className="border-t bg-background">
        <div className="max-w-3xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            {current > 1 && (
              <Button type="button" variant="ghost" onClick={goBack}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            {!isLast ? (
              <Button
                type="button"
                variant="outline"
                onClick={advance}
                disabled={!stepDone}
              >
                Next
              </Button>
            ) : (
              <Button type="button" onClick={finish} disabled={!stepDone}>
                Finish
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
