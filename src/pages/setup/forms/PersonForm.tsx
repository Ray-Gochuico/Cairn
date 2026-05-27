import { usePersonsStore } from '@/stores/persons-store';
import PersonFormImpl, {
  DEFAULT_PERSON,
} from '@/components/forms/PersonForm';

interface Props {
  /** Fires after a successful create (used by the wizard Dialog to close). */
  onSaved?: () => void;
}

/**
 * Wizard wrapper around the canonical PersonForm. Adds one row at a
 * time; the wizard's "Add another?" flow re-opens the Dialog after each
 * save.
 */
export default function PersonForm({ onSaved }: Props) {
  const create = usePersonsStore((s) => s.create);
  return (
    <PersonFormImpl
      initial={DEFAULT_PERSON}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={onSaved}
      submitLabel="Add Person"
    />
  );
}
