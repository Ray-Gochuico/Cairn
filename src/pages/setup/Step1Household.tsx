import { useEffect, useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdForm, { type HouseholdFormValues } from '@/components/forms/HouseholdForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 1 — Household. The household row is seeded by
 * migration, so this is always an `update`. On a successful save the
 * step signals the wizard via `onComplete()` to advance to Step 2.
 */
export default function Step1Household({ onComplete }: Props) {
  const { household, load, update, isLoading, error } = useHouseholdStore();

  const values = useMemo<HouseholdFormValues | undefined>(() => {
    if (!household) return undefined;
    return {
      name: household.name ?? null,
      filingStatus: household.filingStatus,
      state: household.state,
      city: household.city,
      monthlyExpenseBaseline: household.monthlyExpenseBaseline,
      withdrawalRate: household.withdrawalRate,
      inflationAssumption: household.inflationAssumption,
      growthScenarios: household.growthScenarios,
    };
  }, [household]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Household</h2>
        <p className="text-sm text-muted-foreground">
          Start with the shared settings — filing status, state, expense baseline, and assumptions used by every calculator.
        </p>
      </div>

      <HouseholdForm
        values={values}
        onSubmit={async (next) => {
          await update(next);
          onComplete();
        }}
        isLoading={isLoading}
        error={error}
        submitLabel="Save & Continue"
      />
    </div>
  );
}
