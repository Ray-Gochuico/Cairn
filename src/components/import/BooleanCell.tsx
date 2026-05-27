import type { CellError } from '@/lib/import/types';

interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  error?: CellError;
}

/**
 * Reusable boolean checkbox cell. Used for `excluded_from_net_worth` on
 * Property + Vehicle preview tables.
 */
export function BooleanCell({ value, onChange, error }: Props) {
  return (
    <div className="flex items-center">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer"
      />
      {error && <span className="ml-2 text-xs text-destructive italic">{error.message}</span>}
    </div>
  );
}

export default BooleanCell;
