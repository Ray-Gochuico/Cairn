import { useRef, type ReactNode } from 'react';
import { useVirtualizer, observeElementRect, observeElementOffset } from '@tanstack/react-virtual';
import type { PreviewRow } from '@/lib/import/types';

// Tunables for the virtualizer. ROW_HEIGHT is the estimate the virtualizer
// uses to compute offsets before a row is measured — preview rows are taller
// than a display row (each carries inline cell editors) so a generous estimate
// keeps the scrollbar honest. A minor mis-estimate just costs one extra
// scroll-position recalculation. OVERSCAN keeps a buffer of rows mounted just
// outside the viewport so scrolling never reveals an empty placeholder.
export const PREVIEW_ROW_HEIGHT = 44;
export const PREVIEW_OVERSCAN = 8;

// The modal body the table lives in is capped at 55vh; the scroll parent here
// owns that bound so the virtualizer measures a real, finite viewport.
const SCROLL_CLASS = 'max-h-[55vh] overflow-auto';

/**
 * Shared frozen empty array for the `state.ctx.<pool> ?? EMPTY_OPTIONS`
 * fallback every table uses. A fresh `[]` literal would change identity each
 * render and defeat the per-row React.memo (the options/persons props would
 * never compare equal); a single stable reference keeps the memo meaningful.
 */
export const EMPTY_OPTIONS: ReadonlyArray<never> = Object.freeze([]);

interface Props<TResolved> {
  /** The derived rows to render. Only the visible window is mounted. */
  rows: ReadonlyArray<PreviewRow<TResolved>>;
  /** The number of `<th>` columns — used to span the padding spacer rows. */
  columnCount: number;
  /** The `<thead>`'s `<tr>` children (the column headers). */
  head: ReactNode;
  /** Renders one row. Must return a `<tr>` keyed by `row.rowId`. */
  renderRow: (row: PreviewRow<TResolved>) => ReactNode;
  /** Shown (instead of the table) when there are no rows to preview. */
  empty: ReactNode;
  /** Optional className for the `<thead>` (defaults to the shared header style). */
  headClassName?: string;
}

/**
 * Shared virtualized shell for the ten import-preview tables. Reuses the
 * proven SpendingTransactions pattern: a bounded scroll parent, a TanStack
 * virtualizer keyed by stable rowId, padding spacer rows so the scrollbar
 * height stays accurate even though only ~30 rows are in the DOM, and a
 * jsdom-viewport fallback so every existing getByText/getByRole test (which
 * relies on all rows being present) keeps working under vitest.
 *
 * A 10k-row bank export used to mount 10k <tr>s — each with a DatePicker and
 * two comboboxes fed the full accounts/categories arrays — and jsdom froze for
 * seconds (real WebKit worse). Clipping the DOM to the visible window fixes the
 * freeze; the per-row React.memo in each caller fixes the per-keystroke
 * re-render of every row.
 */
export function VirtualizedPreviewTable<TResolved>({
  rows,
  columnCount,
  head,
  renderRow,
  empty,
  headClassName = 'bg-muted text-xs uppercase text-muted-foreground',
}: Props<TResolved>) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => PREVIEW_ROW_HEIGHT,
    overscan: PREVIEW_OVERSCAN,
    // Stable item key keeps row identity (and measured heights) across edits
    // and scroll, mirroring SpendingTransactions.
    getItemKey: (index) => rows[index]?.rowId ?? index,
    // Fallback for environments that don't paint layout — primarily jsdom in
    // vitest, where getBoundingClientRect is always {0,0}. Without this,
    // observeElementRect clamps the viewport to {0,0} and the virtualizer
    // renders zero rows, breaking every existing test that relies on
    // getByText / getByRole('row'). We substitute a real, FINITE 1000×800
    // viewport (mirroring SpendingTransactions): finite so the virtualizer
    // still windows under stress (a 5k-row test mounts ~30 rows, not 5k),
    // yet tall enough that every existing 1–2-row table test still mounts all
    // its rows. Real browsers get accurate measurements via the unchanged
    // offset observer.
    observeElementRect: (instance, cb) => {
      return observeElementRect(instance, (rect) => {
        if (rect.height === 0 && rect.width === 0) {
          cb({ width: 1000, height: 800 });
        } else {
          cb(rect);
        }
      });
    },
    observeElementOffset,
  });

  if (rows.length === 0) {
    return <>{empty}</>;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  // Padding spacers around the rendered slice — keeps the scrollbar height
  // accurate even though only ~30 rows are in the DOM at any moment.
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="border rounded overflow-hidden">
      <div ref={scrollParentRef} className={SCROLL_CLASS} data-testid="preview-scroll-parent">
        <table className="w-full text-sm">
          <thead className={headClassName}>
            <tr>{head}</tr>
          </thead>
          <tbody className="divide-y">
            {paddingTop > 0 && (
              <tr aria-hidden="true" style={{ height: paddingTop }}>
                <td colSpan={columnCount} />
              </tr>
            )}
            {virtualItems.map((vi) => {
              const row = rows[vi.index];
              if (!row) return null;
              return renderRow(row);
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden="true" style={{ height: paddingBottom }}>
                <td colSpan={columnCount} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Stable empty-state shared by every preview table. */
export function PreviewEmptyState() {
  return (
    <div className="border rounded p-6 text-center text-sm text-muted-foreground">
      No rows to preview — they were all removed.
    </div>
  );
}
