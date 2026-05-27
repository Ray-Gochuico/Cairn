import { useEffect } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useGoalsStore } from '@/stores/goals-store';
import { usePersonsStore } from '@/stores/persons-store';
import GoalFormImpl, { DEFAULT_GOAL } from '@/components/forms/GoalForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical GoalForm. */
export default function GoalForm({ onSaved }: Props) {
  const create = useGoalsStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();
  const { accounts, load: loadAccounts } = useAccountsStore();

  useEffect(() => {
    void loadPersons();
    void loadAccounts();
  }, [loadPersons, loadAccounts]);

  return (
    <GoalFormImpl
      initial={DEFAULT_GOAL}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      accounts={accounts.map((a) => ({
        id: a.id!,
        name: a.name,
        institution: a.institution,
      }))}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Goal"
    />
  );
}
