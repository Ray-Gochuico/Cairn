import { useEffect } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { LoanType } from '@/types/enums';
import PropertyFormImpl, {
  DEFAULT_PROPERTY,
} from '@/components/forms/PropertyForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical PropertyForm. */
export default function PropertyForm({ onSaved }: Props) {
  const create = usePropertiesStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();

  useEffect(() => {
    void loadPersons();
    void loadLoans();
  }, [loadPersons, loadLoans]);

  const mortgageLoanOptions = loans
    .filter((l) => l.type === LoanType.MORTGAGE)
    .map((l) => ({ id: l.id!, name: l.name }));

  return (
    <PropertyFormImpl
      initial={DEFAULT_PROPERTY}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      mortgageLoans={mortgageLoanOptions}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Property"
    />
  );
}
