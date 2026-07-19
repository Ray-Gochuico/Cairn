import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CalcColumn {
  key: string;
  header: ReactNode;
  /** Right-aligned tabular-nums column (money, rates, counts). */
  numeric?: boolean;
}

interface CalcTableProps {
  columns: CalcColumn[];
  /** <CalcRow> elements (or raw <tr> for exotic rows like group subtotals). */
  children: ReactNode;
  testId?: string;
}

/**
 * Canonical calculator table (Wave 18). ONE header style (xs uppercase
 * tracking muted — the Allocator's Wave-9 idiom), right-aligned numeric
 * columns, ONE row-rule direction (border-b, last row bare). Always wrapped
 * in overflow-x-auto so a narrow workbench scrolls the table, not the page.
 */
export function CalcTable({ columns, children, testId }: CalcTableProps) {
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('py-2 pr-2 font-medium', c.numeric && 'text-right pl-2 pr-0')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

interface CalcRowProps {
  columns: CalcColumn[];
  /** One cell per column, in column order. */
  cells: ReactNode[];
  testId?: string;
  /** Muted group-subtotal styling (Allocator's per-class subtotal rows). */
  subtotal?: boolean;
}

export function CalcRow({ columns, cells, testId, subtotal = false }: CalcRowProps) {
  return (
    <tr
      className={cn('border-b last:border-b-0', subtotal && 'text-muted-foreground')}
      data-testid={testId}
    >
      {cells.map((cell, i) => (
        <td
          key={columns[i]?.key ?? i}
          className={cn(
            'py-2 pr-2',
            columns[i]?.numeric && 'text-right pl-2 pr-0 tabular-nums',
            subtotal && 'font-medium',
          )}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}
