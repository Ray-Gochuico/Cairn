import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  options: ReadonlyArray<string>;
  onChange: (value: string) => void;
  error?: CellError;
}

/**
 * Generic enum cell — a native `<select>` populated from a string-literal
 * list. Used by AccountPreviewTable (AccountType), LoanPreviewTable
 * (LoanType), VehiclePreviewTable (VehicleType), ContributionPreviewTable
 * (ContributionSource), and AssetValueSnapshotPreviewTable (owner_type).
 *
 * Stays a native element (no Radix) so it works inside table rows without
 * portal-z-index drama.
 */
export function EnumCell({ value, options, onChange, error }: Props) {
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-2 py-1 text-sm border rounded ${
          error ? 'border-destructive bg-destructive/10' : 'border-input'
        }`}
      >
        {!options.includes(value) && (
          <option value={value} disabled>
            {value || '—'}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {error && <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{error.message}</div>}
    </div>
  );
}

export default EnumCell;
