import { useEffect } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { usePersonsStore } from '@/stores/persons-store';
import AccountFormImpl, {
  DEFAULT_ACCOUNT,
} from '@/components/forms/AccountForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical AccountForm. */
export default function AccountForm({ onSaved }: Props) {
  const create = useAccountsStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();

  useEffect(() => {
    void loadPersons();
    void loadDependents();
  }, [loadPersons, loadDependents]);

  return (
    <AccountFormImpl
      initial={DEFAULT_ACCOUNT}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      dependents={dependents.map((d) => ({ id: d.id!, name: d.name }))}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Account"
    />
  );
}
