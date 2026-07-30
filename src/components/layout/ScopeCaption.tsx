import { cn } from '@/lib/utils';
import { useViewScope } from '@/lib/use-view-scope';
import { hiddenClause, type HiddenPartition } from '@/lib/view-scope';

export interface ScopeCaptionProps {
  /** Plural noun for the rows, e.g. 'loans', 'goals', 'vehicles and leases'. */
  noun: string;
  partition: HiddenPartition;
  /** 'joint' (default) or 'shared' (goals). */
  jointWord?: string;
  /** 'owned by' (default) or 'for' (goals). */
  otherVerb?: string;
  className?: string;
}

/**
 * The canonical nonempty-view exclusion caption (Copy contract C2/C3):
 * "Showing Alice's loans: 2 of 5 — 2 joint and 1 owned by Bob not shown."
 * Renders nothing in household view, when the filter hid nothing, or when
 * the view is empty (that is FilteredEmptyState's job). Muted text — a
 * declaration, never a warning.
 */
export function ScopeCaption({ noun, partition, jointWord, otherVerb, className }: ScopeCaptionProps) {
  const { isFiltered, filter, personName, otherName } = useViewScope();
  if (!isFiltered || partition.hiddenCount === 0 || partition.visibleCount === 0) return null;
  const subject = filter === 'joint' ? `joint ${noun}` : `${personName}'s ${noun}`;
  const clause = hiddenClause(partition, { filter, otherName, jointWord, otherVerb });
  return (
    <p data-testid="scope-caption" className={cn('text-sm text-muted-foreground', className)}>
      Showing {subject}: {partition.visibleCount} of {partition.total} — {clause} not shown.
    </p>
  );
}
