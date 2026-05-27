import { useEffect } from 'react';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { usePersonsStore } from '@/stores/persons-store';
import HousingPaymentFormImpl, {
  DEFAULT_HOUSING_PAYMENT,
} from '@/components/forms/HousingPaymentForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical HousingPaymentForm. */
export default function HousingPaymentForm({ onSaved }: Props) {
  const create = useHousingPaymentsStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();

  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  return (
    <HousingPaymentFormImpl
      initial={DEFAULT_HOUSING_PAYMENT}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Rent"
    />
  );
}
