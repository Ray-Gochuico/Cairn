import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  error?: CellError;
  onChange: (next: string) => void;
}

export function ReimbursableCell({ value, error, onChange }: Props) {
  const normalized = value.trim().toLowerCase();
  const current = normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1'
    ? 'true'
    : normalized === 'false' || normalized === 'no' || normalized === 'n' || normalized === '0'
      ? 'false'
      : '';
  return (
    <div>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-2 py-1 text-sm border rounded ${error ? 'border-destructive bg-destructive/10' : 'border-input'}`}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
      {error && <div className="text-xs text-destructive italic mt-0.5">{error.message}</div>}
    </div>
  );
}
