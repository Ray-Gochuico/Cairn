import { useCallback, useMemo, useState } from 'react';
import { PaycheckCard } from './PaycheckCard';
import { BonusTaxCard } from './BonusTaxCard';
import { CommissionTaxCard } from './CommissionTaxCard';
import { OvertimeCard } from './OvertimeCard';
import { FireCard } from './FireCard';
import { CoastFiCard } from './CoastFiCard';
import { DebtPayoffCard } from './DebtPayoffCard';
import { EquityValueCard } from './EquityValueCard';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { Button } from '@/components/ui/button';
import { getHiddenCards, showCard } from '@/lib/calculator-visibility';

const STALE_BANNER_STORAGE_KEY = 'stale-tax-year-banner-dismissed';

// Stable kebab-case ids for each calculator card.
const CARD_IDS = {
  PAYCHECK: 'paycheck',
  BONUS: 'bonus-tax',
  COMMISSION: 'commission',
  OVERTIME: 'overtime',
  FIRE: 'fire',
  COAST_FI: 'coast-fi',
  DEBT_PAYOFF: 'debt-payoff',
  EQUITY: 'equity',
} as const;

// Human-friendly labels surfaced in the "manage" popover.
const CARD_LABELS: Record<string, string> = {
  [CARD_IDS.PAYCHECK]: 'Take-home paycheck',
  [CARD_IDS.BONUS]: 'Bonus tax',
  [CARD_IDS.COMMISSION]: 'Commission tax',
  [CARD_IDS.OVERTIME]: 'Overtime',
  [CARD_IDS.FIRE]: 'Years to FI',
  [CARD_IDS.COAST_FI]: 'CoastFI',
  [CARD_IDS.DEBT_PAYOFF]: 'Debt Payoff',
  [CARD_IDS.EQUITY]: 'Equity Value',
};

function labelFor(id: string): string {
  return CARD_LABELS[id] ?? id;
}

export default function CalculatorsLayout() {
  const { persons } = usePersonsStore();
  const showOvertime = persons.some(
    (p) => p.employmentType === 'HOURLY' || p.employmentType === 'SALARY_WITH_OT',
  );

  // Resolve the active tax year from the seeded set so we can warn when the
  // app's bundled rules predate the current calendar year.
  const taxItems = useTaxRulesStore((s) => s.items);
  const seededYears = useMemo(
    () => [...new Set(taxItems.map((r) => r.year))],
    [taxItems],
  );
  const { year: resolvedYear, isCurrent } = getCurrentTaxYear(seededYears);
  const showBanner = resolvedYear !== null && !isCurrent;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STALE_BANNER_STORAGE_KEY) === 'true';
    } catch {
      // SSR / sandboxed environments where sessionStorage is unavailable
      return false;
    }
  });

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(STALE_BANNER_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors; in-memory dismiss still applies for this render.
    }
    setDismissed(true);
  };

  // Track which cards the user has hidden. Lazy-init from localStorage so the
  // first render reflects persisted prefs without a flash.
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(
    () => new Set(getHiddenCards()),
  );

  const refreshHidden = useCallback(() => {
    setHiddenSet(new Set(getHiddenCards()));
  }, []);

  const handleShow = useCallback(
    (id: string) => {
      showCard(id);
      refreshHidden();
    },
    [refreshHidden],
  );

  const hiddenList = useMemo(() => Array.from(hiddenSet), [hiddenSet]);
  const hiddenCount = hiddenList.length;

  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Use "Override" on any card to try a what-if.
      </p>
      {showBanner && !dismissed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100"
        >
          <span>
            Using {resolvedYear} tax brackets — update the app for newer rates.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            aria-label="Dismiss stale tax year banner"
            className="text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
          >
            Dismiss
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        {!hiddenSet.has(CARD_IDS.PAYCHECK) && (
          <PaycheckCard cardId={CARD_IDS.PAYCHECK} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.BONUS) && (
          <BonusTaxCard cardId={CARD_IDS.BONUS} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.COMMISSION) && (
          <CommissionTaxCard cardId={CARD_IDS.COMMISSION} onHide={refreshHidden} />
        )}
        {showOvertime && !hiddenSet.has(CARD_IDS.OVERTIME) && (
          <OvertimeCard cardId={CARD_IDS.OVERTIME} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.FIRE) && (
          <FireCard cardId={CARD_IDS.FIRE} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.COAST_FI) && (
          <CoastFiCard cardId={CARD_IDS.COAST_FI} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.DEBT_PAYOFF) && (
          <DebtPayoffCard cardId={CARD_IDS.DEBT_PAYOFF} onHide={refreshHidden} />
        )}
        {!hiddenSet.has(CARD_IDS.EQUITY) && (
          <EquityValueCard cardId={CARD_IDS.EQUITY} onHide={refreshHidden} />
        )}
      </div>
      {hiddenCount > 0 && (
        <footer className="pt-2 text-sm text-muted-foreground">
          <details className="relative inline-block">
            <summary className="cursor-pointer list-none select-none">
              {hiddenCount === 1 ? '1 card hidden' : `${hiddenCount} cards hidden`}
              {' — '}
              <span className="underline">manage</span>
            </summary>
            <div
              role="dialog"
              aria-label="Hidden calculator cards"
              className="absolute left-0 mt-2 w-64 rounded-md border bg-background shadow-md p-2 z-10"
            >
              <ul className="space-y-1">
                {hiddenList.map((id) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span className="text-sm text-foreground">{labelFor(id)}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleShow(id)}
                      aria-label={`Show ${labelFor(id)} card`}
                    >
                      Show
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </footer>
      )}
    </div>
  );
}
