import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { localTodayISO } from '@/lib/dates';

const HOUSEHOLD_SCOPE_NOTE =
  "Exports all household rows — the person view doesn't change what's exported.";

interface ExportCsvButtonProps<T> {
  /** Filename stem — the download is `<baseName>-<YYYY-MM-DD>.csv`. */
  baseName: string;
  /** Column map: header label + pure cell extractor per column. */
  columns: CsvColumn<T>[];
  /** The full row set to export. */
  rows: T[];
  /** Button label. Defaults to "Export CSV". */
  label?: string;
  /** Button size — forwarded to the shadcn Button. Defaults to the Button's default. */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Wave A D5: renders the uniform household-scope disclosure (C24) —
   *  exports NEVER scope to the ?view= filter (a person-view session must
   *  not produce a silently-partial backup). Set on person-page exports. */
  householdScopeNote?: boolean;
}

/**
 * A reusable "Export CSV" button. On click it serializes `rows` with
 * `toCsv` and downloads the result. Disabled when `rows` is empty — there
 * is nothing to export. Generic over the row type so every page reuses it.
 */
export function ExportCsvButton<T>({
  baseName,
  columns,
  rows,
  label = 'Export CSV',
  size,
  householdScopeNote,
}: ExportCsvButtonProps<T>) {
  // W19 review: the Tauri branch of downloadCsv can reject AFTER the user
  // picked a destination (read-only volume, disk full) — swallowing that
  // would read as success, since the save dialog already closed.
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  const handleClick = async () => {
    // v1.8.0 A-2′: the LOCAL calendar day — the UTC day is already tomorrow
    // on a US evening and still yesterday on an Auckland morning.
    const today = localTodayISO();
    setError(null);
    try {
      await downloadCsv(`${baseName}-${today}.csv`, toCsv(rows, columns));
    } catch {
      setError("Couldn't save the file — try a different location.");
    }
  };

  return (
    <>
      {householdScopeNote && (
        <span id={noteId} className="sr-only">
          {HOUSEHOLD_SCOPE_NOTE}
        </span>
      )}
      <Button
        variant="outline"
        size={size}
        onClick={() => void handleClick()}
        disabled={rows.length === 0}
        title={householdScopeNote ? HOUSEHOLD_SCOPE_NOTE : undefined}
        aria-describedby={householdScopeNote ? noteId : undefined}
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive-soft-foreground">
          {error}
        </span>
      )}
    </>
  );
}
