import { useEffect, useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import HouseholdFormImpl, {
  type HouseholdFormValues,
} from '@/components/forms/HouseholdForm';

interface Props {
  /** Fires after a successful save (used by the wizard Dialog to close). */
  onSaved?: () => void;
}

/**
 * Wizard wrapper around the canonical HouseholdForm. The Household row
 * is a singleton seeded by migration, so this is always an `update`.
 */
export default function HouseholdForm({ onSaved }: Props) {
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
    void load();
  }, [load]);

  return (
    <HouseholdFormImpl
      values={values}
      onSubmit={async (next) => {
        await update(next);
        onSaved?.();
      }}
      isLoading={isLoading}
      error={error}
      submitLabel="Save"
    />
  );
}
