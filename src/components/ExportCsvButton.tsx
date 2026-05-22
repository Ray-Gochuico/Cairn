import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';

interface ExportCsvButtonProps<T> {
  /** Filename stem — the download is `<baseName>-<YYYY-MM-DD>.csv`. */
  baseName: string;
  /** Column map: header label + pure cell extractor per column. */
  columns: CsvColumn<T>[];
  /** The full row set to export. */
  rows: T[];
  /** Button label. Defaults to "Export CSV". */
  label?: string;
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
}: ExportCsvButtonProps<T>) {
  const handleClick = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`${baseName}-${today}.csv`, toCsv(rows, columns));
  };

  return (
    <Button variant="outline" onClick={handleClick} disabled={rows.length === 0}>
      {label}
    </Button>
  );
}
