import { useEffect, useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdForm, { type HouseholdFormValues } from '@/components/forms/HouseholdForm';

export default function HouseholdTab() {
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
    <div className="p-6 max-w-2xl min-w-0" data-testid="household-tab">
      <h2 className="text-2xl font-semibold mb-1">Household</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Settings shared across the household — filing status, location, expense baseline, and assumptions used by every calculator.
      </p>

      <HouseholdForm
        values={values}
        onSubmit={async (next) => {
          await update(next);
        }}
        isLoading={isLoading}
        error={error}
        showSavedConfirmation
      />
    </div>
  );
}
