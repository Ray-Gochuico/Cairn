import { useCallback, useEffect, useMemo, useState } from 'react';
import { PaycheckCard } from './PaycheckCard';
import { BonusTaxCard } from './BonusTaxCard';
import { CommissionTaxCard } from './CommissionTaxCard';
import { OvertimeCard } from './OvertimeCard';
import { FinancialIndependenceCard } from './FinancialIndependenceCard';
import { CoastFiCard } from './CoastFiCard';
import { DebtPayoffCard } from './DebtPayoffCard';
import { EquityValueCard } from './EquityValueCard';
import { CompoundInterestCard } from './CompoundInterestCard';
import { Retirement401kWithdrawalCard } from './Retirement401kWithdrawalCard';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { Button } from '@/components/ui/button';
import { getHiddenCards, persistHiddenCards } from '@/lib/calculator-visibility';

const STALE_BANNER_STORAGE_KEY = 'stale-tax-year-banner-dismissed';

// Stable kebab-case ids for each calculator card.
const CARD_IDS = {
  PAYCHECK: 'paycheck',
  BONUS: 'bonus-tax',
  COMMISSION: 'commission',
  OVERTIME: 'overtime',
  FINANCIAL_INDEPENDENCE: 'financial-independence',
  COAST_FI: 'coast-fi',
  COMPOUND: 'compound-interest',
  DEBT_PAYOFF: 'debt-payoff',
  EQUITY: 'equity',
  RETIREMENT_401K: 'retirement-401k-withdrawal',
} as const;

// Human-friendly labels surfaced in the "manage" popover.
const CARD_LABELS: Record<string, string> = {
  [CARD_IDS.PAYCHECK]: 'Take-home paycheck',
  [CARD_IDS.BONUS]: 'Bonus tax',
  [CARD_IDS.COMMISSION]: 'Commission tax',
  [CARD_IDS.OVERTIME]: 'Overtime',
  [CARD_IDS.FINANCIAL_INDEPENDENCE]: 'Years to FI',
  [CARD_IDS.COAST_FI]: 'CoastFI',
  [CARD_IDS.COMPOUND]: 'Compound Interest',
  [CARD_IDS.DEBT_PAYOFF]: 'Debt Payoff',
  [CARD_IDS.EQUITY]: 'Equity Value',
  [CARD_IDS.RETIREMENT_401K]: '401k withdrawal tax',
};

function labelFor(id: string): string {
  return CARD_LABELS[id] ?? id;
}

export default function CalculatorsLayout() {
  // Note: the household/p1/p2 view filter from useViewFilter is intentionally
  // NOT wired in here. Each calculator card has its own per-card behaviour —
  // Paycheck / Financial Independence / CoastFI / Equity Value naturally split per-person via
  // their underlying calcs; Bonus Tax always shows MFJ-combined for household
  // and per-person for p1/p2; and each card already auto-shows or hides based
  // on whether the relevant inputs exist. Adding a person filter at the
  // layout level would shadow those behaviours, so it stays out-of-scope for
  // Phase 3.
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

  // Track which cards the user has hidden. The React state is the source of
  // truth within the session; localStorage is a side-effect persister kept in
  // sync through `persistHiddenCards`. Storing an array (not a Set) keeps the
  // value structurally comparable so functional updaters can bail out of
  // redundant writes, and lets the popover render in a stable order matching
  // the user's hide sequence.
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => getHiddenCards());

  const handleHide = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      persistHiddenCards(next);
      return next;
    });
  }, []);

  const handleShow = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter((x) => x !== id);
      persistHiddenCards(next);
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setHiddenIds((prev) => {
      if (prev.length === 0) return prev;
      persistHiddenCards([]);
      return [];
    });
  }, []);

  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const hiddenCount = hiddenIds.length;

  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    if (hiddenCount === 0) setPopoverOpen(false);
  }, [hiddenCount]);

  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Use "Override" on any card to try a what-if.
      </p>
      {showBanner && !dismissed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-foreground"
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
            className="text-warning-foreground hover:bg-warning/10"
          >
            Dismiss
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        {!hiddenSet.has(CARD_IDS.PAYCHECK) && (
          <PaycheckCard cardId={CARD_IDS.PAYCHECK} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.BONUS) && (
          <BonusTaxCard cardId={CARD_IDS.BONUS} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.RETIREMENT_401K) && (
          <Retirement401kWithdrawalCard
            cardId={CARD_IDS.RETIREMENT_401K}
            onHide={handleHide}
          />
        )}
        {!hiddenSet.has(CARD_IDS.COMMISSION) && (
          <CommissionTaxCard cardId={CARD_IDS.COMMISSION} onHide={handleHide} />
        )}
        {showOvertime && !hiddenSet.has(CARD_IDS.OVERTIME) && (
          <OvertimeCard cardId={CARD_IDS.OVERTIME} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.FINANCIAL_INDEPENDENCE) && (
          <FinancialIndependenceCard
            cardId={CARD_IDS.FINANCIAL_INDEPENDENCE}
            onHide={handleHide}
          />
        )}
        {!hiddenSet.has(CARD_IDS.COAST_FI) && (
          <CoastFiCard cardId={CARD_IDS.COAST_FI} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.COMPOUND) && (
          <CompoundInterestCard cardId={CARD_IDS.COMPOUND} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.DEBT_PAYOFF) && (
          <DebtPayoffCard cardId={CARD_IDS.DEBT_PAYOFF} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.EQUITY) && (
          <EquityValueCard cardId={CARD_IDS.EQUITY} onHide={handleHide} />
        )}
      </div>
      {hiddenCount > 0 && (
        <footer className="pt-2 text-sm text-muted-foreground relative">
          <button
            type="button"
            onClick={() => setPopoverOpen((v) => !v)}
            aria-expanded={popoverOpen}
            aria-haspopup="dialog"
            className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-foreground transition-colors"
          >
            {hiddenCount === 1 ? '1 card hidden' : `${hiddenCount} cards hidden`}
            {' — '}
            <span className="font-medium">manage</span>
          </button>
          {popoverOpen && (
            <>
              {/* Backdrop — closes the popover when clicked outside. */}
              <div
                className="fixed inset-0 z-10"
                aria-hidden="true"
                onClick={() => setPopoverOpen(false)}
              />
              <div
                role="dialog"
                aria-label="Hidden calculator cards"
                className="absolute left-0 bottom-full mb-2 w-72 rounded-md border bg-background shadow-lg p-2 z-20"
              >
                <div className="flex items-center justify-between px-2 pt-1 pb-2 border-b mb-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Hidden cards
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      handleShowAll();
                      setPopoverOpen(false);
                    }}
                    className="h-6 text-xs"
                  >
                    Show all
                  </Button>
                </div>
                <ul className="space-y-0.5 max-h-72 overflow-y-auto">
                  {hiddenIds.map((id) => (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/40"
                    >
                      <span className="text-sm text-foreground">{labelFor(id)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleShow(id)}
                        aria-label={`Show ${labelFor(id)} card`}
                        className="h-7"
                      >
                        Show
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
