import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The single canonical page frame (Design H-3).
 *
 * Before this primitive, every page hand-rolled its own outer wrapper: some
 * used `p-6`, others `p-8`; max-widths ranged across `max-w-3xl` / `4xl` /
 * `5xl` / `6xl` / none; some centered with `mx-auto`, some didn't. The result
 * was a content edge that jumped on every navigation. PageContainer codifies
 * ONE inset (`px-6 py-6`) and ONE default content cap (`max-w-6xl`), centered,
 * so the reading column is stable app-wide.
 *
 * Width is the only knob. The default ('default') is the wide app cap used by
 * the data-dense pages (Dashboard, Net Worth, Investments, Goals, Loans, …).
 * A page that wants a narrower reading column (Learn, Roadmap, the Monthly
 * mini-window) opts in with `width="prose"`; a page that is intentionally
 * full-bleed (Spending, transactions table, What-If) opts in with
 * `width="full"`. Padding stays identical across all three so only the cap
 * changes — the inset never jumps.
 *
 * Rendered at the PAGE level (each page wraps its own body), not in PageShell:
 * pages are unit-tested in isolation (mounted under a bare MemoryRouter), so
 * the frame must travel with the page, not the shell.
 */
export type PageWidth = 'default' | 'prose' | 'full';

const WIDTH_CLASS: Record<PageWidth, string> = {
  // Wide app default — the data-dense surfaces.
  default: 'max-w-6xl',
  // Narrow reading column for long-form / wizard-like surfaces.
  prose: 'max-w-3xl',
  // No cap — intentionally full-bleed pages.
  full: '',
};

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  width?: PageWidth;
}

export const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ width = 'default', className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Canonical inset + centered column. Codified ONCE here.
        'mx-auto w-full px-6 py-6',
        WIDTH_CLASS[width],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
PageContainer.displayName = 'PageContainer';

export default PageContainer;
