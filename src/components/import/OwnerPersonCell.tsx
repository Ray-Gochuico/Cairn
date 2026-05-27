import type { CellError } from '@/lib/import/types';

interface Props {
  value: number | null;
  persons: ReadonlyArray<{ id: number; name: string }>;
  onChange: (value: number | null) => void;
  error?: CellError;
}

/**
 * Reusable cell for picking a person (or no one — "joint" / household-level).
 * Used by Account, Loan, Property, Vehicle preview tables (and any future
 * entity whose schema has an ownerPersonId field).
 */
export function OwnerPersonCell({ value, persons, onChange, error }: Props) {
  return (
    <div>
      <select
        value={value === null ? '' : String(value)}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        className={`w-full px-2 py-1 text-sm border rounded ${
          error ? 'border-destructive bg-destructive/10' : 'border-input'
        }`}
      >
        <option value="">(none — joint)</option>
        {persons.map((p) => (
          <option key={p.id} value={String(p.id)}>{p.name}</option>
        ))}
      </select>
      {error && <div className="text-xs text-destructive italic mt-0.5">{error.message}</div>}
    </div>
  );
}

export default OwnerPersonCell;
