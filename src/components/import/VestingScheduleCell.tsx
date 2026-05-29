import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CellError } from '@/lib/import/types';

interface VestingRow {
  date: string;
  cumulativePct: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  error?: CellError;
}

/**
 * Parse the JSON-encoded vesting schedule into a row array. Returns null if
 * the JSON is malformed OR the parsed value isn't an array — the caller
 * surfaces this as a "No schedule" summary, with the actual cell-error
 * message coming from the validator's CellError (separate from parsing).
 */
function parseSchedule(value: string): VestingRow[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    // Coerce to VestingRow[] for summary purposes — full structural validation
    // happens in the equity-grant validator.
    return parsed as VestingRow[];
  } catch {
    return null;
  }
}

/**
 * Cell for the equity-grant vesting-schedule JSON column. Shows a compact
 * summary (row count + first→last percentage) and lets the user pop open a
 * `<textarea>` editor to fix malformed input. The validator carries the
 * structured error message via the `error` prop.
 */
export function VestingScheduleCell({ value, onChange, error }: Props) {
  const [editing, setEditing] = useState(false);
  const rows = parseSchedule(value);

  if (editing) {
    return (
      <div className="space-y-1">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          rows={4}
          className={`w-full text-xs font-mono px-2 py-1 border rounded ${
            error ? 'border-destructive bg-destructive/10' : 'border-input'
          }`}
        />
        {error && <div className="text-xs text-destructive-soft-foreground italic">{error.message}</div>}
      </div>
    );
  }

  const summary =
    rows && rows.length > 0
      ? `${rows.length} rows, ${(rows[0].cumulativePct * 100).toFixed(0)}% → ${(rows[rows.length - 1].cumulativePct * 100).toFixed(0)}%`
      : 'No schedule';

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs ${error ? 'text-destructive-soft-foreground' : 'text-foreground'}`}>
        {summary}
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setEditing(true)}
        className="text-xs h-auto p-0"
      >
        Edit
      </Button>
      {error && <span className="text-xs text-destructive-soft-foreground italic">{error.message}</span>}
    </div>
  );
}

export default VestingScheduleCell;
