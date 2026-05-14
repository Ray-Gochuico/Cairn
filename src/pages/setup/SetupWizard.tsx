import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Step1Household from './Step1Household';
import Step2Persons from './Step2Persons';
import Step3Employment from './Step3Employment';
import Step3Dependents from './Step3Dependents';
import Step4Accounts from './Step4Accounts';
import Step5Holdings from './Step5Holdings';
import Step6Loans from './Step6Loans';
import Step7PropertyVehicles from './Step7PropertyVehicles';
import Step8Goals from './Step8Goals';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { PriceCache } from '@/market/price-cache';
import { YahooClient } from '@/market/yahoo-client';
import { deriveLast12Months } from '@/market/snapshot-derivation';
import { getDatabase } from '@/db/db';

type StepIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

interface StepMeta {
  index: StepIndex;
  label: string;
}

// Plan deviation: Phase 3 plan called for Employment as Step 2 (before
// Persons), but Step3Employment iterates the persons-store to set
// per-person employment type — that store is empty until Step 2 runs.
// Placed Employment as Step 3 (after Persons) so persons exist when
// this step renders. Total: 8 → 9 steps.
const STEPS: StepMeta[] = [
  { index: 1, label: 'Household' },
  { index: 2, label: 'Persons' },
  { index: 3, label: 'Employment' },
  { index: 4, label: 'Dependents' },
  { index: 5, label: 'Accounts' },
  { index: 6, label: 'Holdings' },
  { index: 7, label: 'Loans' },
  { index: 8, label: 'Property & Vehicles' },
  { index: 9, label: 'Goals' },
];

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
    if (current < 9) {
      setCurrent((current + 1) as StepIndex);
    }
  };

  const goBack = () => {
    if (current > 1) {
      setCurrent((current - 1) as StepIndex);
    }
  };

  /**
   * Finish handler. If the user added both accounts AND holdings during
   * the wizard, fire `deriveLast12Months` in the background so the
   * dashboard has historical snapshots by the time the user clicks
   * Net Worth. This is fire-and-forget — navigation never blocks on
   * Yahoo, mirroring the same pattern src/db/init.ts uses at boot.
   */
  const finish = () => {
    const { accounts } = useAccountsStore.getState();
    const { holdings } = useHoldingsStore.getState();

    if (accounts.length > 0 && holdings.length > 0) {
      void (async () => {
        try {
          const db = getDatabase();
          const accountsRepo = new AccountsRepo(db);
          const holdingsRepo = new HoldingsRepo(db);
          const snapshotsRepo = new AccountSnapshotsRepo(db);
          const prices = new PriceCache(db, new YahooClient());
          await deriveLast12Months({
            accounts: accountsRepo,
            holdings: holdingsRepo,
            snapshots: snapshotsRepo,
            prices,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[setup] snapshot derivation failed:', err);
        }
      })();
    }

    navigate('/', { replace: true });
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
      stepContent = <Step3Employment onComplete={advance} />;
      break;
    case 4:
      stepContent = <Step3Dependents onComplete={advance} />;
      break;
    case 5:
      stepContent = <Step4Accounts onComplete={advance} />;
      break;
    case 6:
      stepContent = <Step5Holdings onComplete={advance} />;
      break;
    case 7:
      stepContent = <Step6Loans onComplete={advance} />;
      break;
    case 8:
      stepContent = <Step7PropertyVehicles onComplete={advance} />;
      break;
    case 9:
      stepContent = <Step8Goals onComplete={finish} />;
      break;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">Welcome — let&apos;s set up your household</h1>
          <p className="text-sm text-muted-foreground">
            Step {current} of 9: {currentMeta.label}
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
        </div>
      </footer>
    </div>
  );
}
