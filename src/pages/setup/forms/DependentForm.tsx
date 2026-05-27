import { useDependentsStore } from '@/stores/dependents-store';
import DependentFormImpl, {
  DEFAULT_DEPENDENT,
} from '@/components/forms/DependentForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical DependentForm. */
export default function DependentForm({ onSaved }: Props) {
  const create = useDependentsStore((s) => s.create);
  return (
    <DependentFormImpl
      initial={DEFAULT_DEPENDENT}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={onSaved}
      submitLabel="Add Dependent"
    />
  );
}
