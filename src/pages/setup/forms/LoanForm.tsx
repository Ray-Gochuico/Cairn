import { useEffect } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import LoanFormImpl, { DEFAULT_LOAN } from '@/components/forms/LoanForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical LoanForm. */
export default function LoanForm({ onSaved }: Props) {
  const create = useLoansStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();
  const { properties, load: loadProperties } = usePropertiesStore();
  const { vehicles, load: loadVehicles } = useVehiclesStore();

  useEffect(() => {
    void loadPersons();
    void loadProperties();
    void loadVehicles();
  }, [loadPersons, loadProperties, loadVehicles]);

  return (
    <LoanFormImpl
      initial={DEFAULT_LOAN}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      properties={properties.map((p) => ({ id: p.id!, name: p.name }))}
      vehicles={vehicles.map((v) => ({ id: v.id!, name: v.name }))}
      initialMonthlyPaymentIsUserSet={false}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Loan"
    />
  );
}
