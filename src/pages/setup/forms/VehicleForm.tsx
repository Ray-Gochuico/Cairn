import { useEffect } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { LoanType } from '@/types/enums';
import VehicleFormImpl, {
  DEFAULT_VEHICLE,
} from '@/components/forms/VehicleForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical VehicleForm. */
export default function VehicleForm({ onSaved }: Props) {
  const create = useVehiclesStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();

  useEffect(() => {
    void loadPersons();
    void loadLoans();
  }, [loadPersons, loadLoans]);

  const autoLoanOptions = loans
    .filter((l) => l.type === LoanType.AUTO)
    .map((l) => ({ id: l.id!, name: l.name }));

  return (
    <VehicleFormImpl
      initial={DEFAULT_VEHICLE}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      autoLoans={autoLoanOptions}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Vehicle"
    />
  );
}
