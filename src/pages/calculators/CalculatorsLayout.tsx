import { useMemo, useState } from 'react';
import { PaycheckCard } from './PaycheckCard';
import { BonusTaxCard } from './BonusTaxCard';
import { CommissionTaxCard } from './CommissionTaxCard';
import { OvertimeCard } from './OvertimeCard';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { Button } from '@/components/ui/button';

const STALE_BANNER_STORAGE_KEY = 'stale-tax-year-banner-dismissed';

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
        <PaycheckCard />
        <BonusTaxCard />
        <CommissionTaxCard />
        {showOvertime && <OvertimeCard />}
      </div>
    </div>
  );
}
