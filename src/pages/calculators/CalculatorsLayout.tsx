import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { BacktestCard } from './BacktestCard';
import { ContributionAllocatorCard } from './ContributionAllocatorCard';
import { ScenarioBar } from './ScenarioBar';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoansStore } from '@/stores/loans-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  applyCalculatorCardLayout,
  CALCULATOR_CARD_IDS,
} from '@/lib/calculator-card-layout';
import type { CardLayoutEntry } from '@/types/schema';

const STALE_BANNER_STORAGE_KEY = 'stale-tax-year-banner-dismissed';

// Stable kebab-case ids for each calculator card. Exported (object form) for
// reuse by the tailoring engine + the one-time import. The canonical ordered
// list lives in calculator-card-layout.ts (CALCULATOR_CARD_IDS); these two
// MUST stay in lock-step.
export const CARD_IDS = {
  PAYCHECK: 'paycheck',
  BONUS: 'bonus-tax',
  COMMISSION: 'commission-tax',
  OVERTIME: 'overtime',
  FINANCIAL_INDEPENDENCE: 'financial-independence',
  COAST_FI: 'coast-fi',
  COMPOUND: 'compound-interest',
  DEBT_PAYOFF: 'debt-payoff',
  EQUITY: 'equity',
  RETIREMENT_401K: 'retirement-401k-withdrawal',
  BACKTEST: 'backtest',
  CONTRIBUTION_ALLOCATOR: 'contribution-allocator',
} as const;

// Human-friendly labels surfaced in the "manage" popover.
export const CARD_LABELS: Record<string, string> = {
  [CARD_IDS.PAYCHECK]: 'Paycheck',
  [CARD_IDS.BONUS]: 'Bonus tax',
  [CARD_IDS.COMMISSION]: 'Commission tax',
  [CARD_IDS.OVERTIME]: 'Overtime',
  [CARD_IDS.FINANCIAL_INDEPENDENCE]: 'Years to FI',
  [CARD_IDS.COAST_FI]: 'CoastFI',
  [CARD_IDS.COMPOUND]: 'Compound Interest',
  [CARD_IDS.DEBT_PAYOFF]: 'Debt Payoff',
  [CARD_IDS.EQUITY]: 'Equity Value',
  [CARD_IDS.RETIREMENT_401K]: '401k withdrawal take-home',
  [CARD_IDS.BACKTEST]: 'Historical Backtest',
  [CARD_IDS.CONTRIBUTION_ALLOCATOR]: 'Contribution allocator',
};

function labelFor(id: string): string {
  return CARD_LABELS[id] ?? id;
}

/**
 * Build the next calculatorCardLayout from the current layout + a single
 * id→hidden mutation. Always returns a COMPLETE entry per CALCULATOR_CARD_IDS
 * so the persisted value is never partial (matches what the one-time import
 * writes). Pure.
 */
function withCardHidden(
  current: CardLayoutEntry[] | null,
  id: string,
  hidden: boolean,
): CardLayoutEntry[] {
  const hiddenById = new Map<string, boolean>();
  for (const entry of current ?? []) hiddenById.set(entry.id, entry.hidden);
  hiddenById.set(id, hidden);
  return CALCULATOR_CARD_IDS.map((cardId) => ({
    id: cardId,
    hidden: hiddenById.get(cardId) === true,
  }));
}

function CalculatorsSkeleton() {
  // Lightweight placeholder shown until settings resolves (cold deep-link to
  // /calculators; usually already warm via Sidebar's boot load). Mirrors the
  // app's lazy-route loading affordance — a non-jumpy neutral block, NOT the
  // 12 cards in a wrong (all-visible) state.
  return (
    <div className="space-y-4 min-w-0" data-testid="calculators-skeleton" aria-busy="true">
      <div className="h-8 w-48 rounded-md bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-full max-w-2xl rounded bg-muted motion-safe:animate-pulse" />
      <div className="grid items-start grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-md border bg-muted/40 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function CalculatorsLayout() {
  const persons = usePersonsStore((s) => s.persons);
  const showOvertime = persons.some(
    (p) => p.employmentType === 'HOURLY' || p.employmentType === 'SALARY_WITH_OT',
  );

  // Cold-boot hydration. The cards READ persons/dependents/portfolio stores
  // but none of them LOAD them, and settings is only boot-loaded by Sidebar —
  // a cold deep-link to /calculators would otherwise see null settings (→
  // skeleton forever) and empty cards. Load them all once for the grid
  // (accounts feed the excluded-from-net-worth filter on the portfolio
  // prefills). W10 M63: household was the one store EVERY card reads that
  // nothing loaded — the FI card read a permanently-null household. Load it.
  const loadAll = useCallback(() => {
    void usePersonsStore.getState().load();
    void useDependentsStore.getState().load();
    void useSnapshotsStore.getState().load();
    void useAccountsStore.getState().load();
    void useContributionsStore.getState().load();
    void useLoansStore.getState().load();
    void useEquityGrantsStore.getState().load();
    void useSettingsStore.getState().load();
    void useHouseholdStore.getState().load();
  }, []);

  // W10 T1: keep the skeleton up until every hydrated store settles, so no
  // card flashes its "add your inputs" CTA over unloaded data.
  const gate = useLoadGate(
    [
      usePersonsStore((s) => s.isLoading),
      useDependentsStore((s) => s.isLoading),
      useSnapshotsStore((s) => s.isLoading),
      useAccountsStore((s) => s.isLoading),
      useContributionsStore((s) => s.isLoading),
      useLoansStore((s) => s.isLoading),
      useEquityGrantsStore((s) => s.isLoading),
      useSettingsStore((s) => s.isLoading),
      useHouseholdStore((s) => s.isLoading),
    ],
    [
      usePersonsStore((s) => s.error),
      useDependentsStore((s) => s.error),
      useSnapshotsStore((s) => s.error),
      useAccountsStore((s) => s.error),
      useContributionsStore((s) => s.error),
      useLoansStore((s) => s.error),
      useEquityGrantsStore((s) => s.error),
      useSettingsStore((s) => s.error),
      useHouseholdStore((s) => s.error),
    ],
    loadAll,
  );

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  // Resolve the active tax year from the seeded set so we can warn when the
  // app's bundled rules predate the current calendar year.
  const taxItems = useTaxRulesStore((s) => s.items);
  const seededYears = useMemo(() => [...new Set(taxItems.map((r) => r.year))], [taxItems]);
  const { year: resolvedYear, isCurrent } = getCurrentTaxYear(seededYears);
  const showBanner = resolvedYear !== null && !isCurrent;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STALE_BANNER_STORAGE_KEY) === 'true';
    } catch {
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

  // Hidden state is sourced SOLELY from the DB-backed overlay (single source
  // of truth). No localStorage seed, no persistHiddenCards write path.
  const cardLayout = settings?.calculatorCardLayout ?? null;
  const hiddenSet = useMemo(
    () => new Set(applyCalculatorCardLayout(CALCULATOR_CARD_IDS, cardLayout)),
    [cardLayout],
  );
  const hiddenCount = hiddenSet.size;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const manageTriggerRef = useRef<HTMLButtonElement>(null);

  // Esc closes the Manage-cards popover and returns focus to its trigger.
  // Pattern: AssetValueChart's IncludedPicker — listener registered only
  // while open; preventDefault marks the event handled so outer Esc
  // handlers that respect defaultPrevented defer to the innermost popover.
  useEffect(() => {
    if (!popoverOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPopoverOpen(false);
        manageTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [popoverOpen]);

  // Toggle one card. Writes the COMPLETE layout to the DB; the store refresh
  // re-renders the grid. Fire-and-forget: update() rethrows on failure but the
  // store records the error; we don't crash the page on a transient write.
  // Closes the popover so the user sees the updated grid immediately.
  const setCardHidden = useCallback(
    (id: string, hidden: boolean) => {
      const next = withCardHidden(settings?.calculatorCardLayout ?? null, id, hidden);
      void updateSettings({ calculatorCardLayout: next }).catch(() => {});
      setPopoverOpen(false);
    },
    [settings?.calculatorCardLayout, updateSettings],
  );

  const handleHide = useCallback((id: string) => setCardHidden(id, true), [setCardHidden]);

  // Render-gate: until settings resolves we cannot know which cards are hidden,
  // so show a skeleton rather than flashing all 12 in a wrong (all-visible)
  // state. settings is usually already warm via Sidebar's boot load.
  if (!gate.settled || settings === null) {
    return <CalculatorsSkeleton />;
  }

  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Edit any field on a card to explore a
        scenario; use <span className="font-medium">Reset to my data</span> to restore it. For
        side-by-side scenario comparisons, see the{' '}
        <Link to="/what-if" className="text-primary hover:underline">What-If</Link> page.
      </p>
      {showBanner && !dismissed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-foreground"
        >
          <span>Using {resolvedYear} tax brackets — update the app for newer rates.</span>
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
      {/* Wave 16 (Basecamp spine): the shared scenario bar — mounts inside the
          settled gate, BETWEEN the intro and the grid. The grid + card shell
          below are untouched (Wave 17 boundary). */}
      <ScenarioBar />
      {/* `items-start` is LOAD-BEARING (masonry grid; see useAutoRowSpan). */}
      <div className="grid items-start grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0 [grid-auto-rows:8px] [grid-auto-flow:row_dense]">
        {!hiddenSet.has(CARD_IDS.PAYCHECK) && (
          <PaycheckCard cardId={CARD_IDS.PAYCHECK} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.BONUS) && (
          <BonusTaxCard cardId={CARD_IDS.BONUS} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.RETIREMENT_401K) && (
          <Retirement401kWithdrawalCard cardId={CARD_IDS.RETIREMENT_401K} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.COMMISSION) && (
          <CommissionTaxCard cardId={CARD_IDS.COMMISSION} onHide={handleHide} />
        )}
        {showOvertime && !hiddenSet.has(CARD_IDS.OVERTIME) && (
          <OvertimeCard cardId={CARD_IDS.OVERTIME} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.FINANCIAL_INDEPENDENCE) && (
          <FinancialIndependenceCard cardId={CARD_IDS.FINANCIAL_INDEPENDENCE} onHide={handleHide} />
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
        {!hiddenSet.has(CARD_IDS.BACKTEST) && (
          <BacktestCard cardId={CARD_IDS.BACKTEST} onHide={handleHide} />
        )}
        {!hiddenSet.has(CARD_IDS.CONTRIBUTION_ALLOCATOR) && (
          <ContributionAllocatorCard cardId={CARD_IDS.CONTRIBUTION_ALLOCATOR} onHide={handleHide} />
        )}
      </div>
      <footer className="pt-2 text-sm text-muted-foreground relative">
        <button
          ref={manageTriggerRef}
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-foreground transition-colors"
        >
          <span className="font-medium">Manage cards</span>
          {hiddenCount > 0 && (
            <> {' — '}{hiddenCount === 1 ? '1 card hidden' : `${hiddenCount} cards hidden`}</>
          )}
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
              aria-label="Manage calculator cards"
              className="absolute left-0 bottom-full mb-2 w-72 rounded-md border bg-background shadow-md p-2 z-20"
            >
              <div className="px-2 pt-1 pb-2 border-b mb-1">
                <span className="text-xs font-medium text-muted-foreground">Show / hide cards</span>
              </div>
              <ul className="space-y-0.5 max-h-80 overflow-y-auto">
                {CALCULATOR_CARD_IDS.map((id) => {
                  const visible = !hiddenSet.has(id);
                  // W10: the Overtime card only renders for an HOURLY/SALARY_WITH_OT
                  // person. Without one, toggling its switch flipped a card that can
                  // never appear — disable it with a reason instead of no-opping.
                  const unavailable = id === CARD_IDS.OVERTIME && !showOvertime;
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/40"
                    >
                      <span className="text-sm text-foreground">
                        {labelFor(id)}
                        {unavailable && (
                          <span className="block text-xs text-muted-foreground">
                            Add an hourly or salary+OT person in Setup to enable this card.
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={visible && !unavailable}
                        disabled={unavailable}
                        onCheckedChange={(next) => setCardHidden(id, !next)}
                        aria-label={labelFor(id)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
