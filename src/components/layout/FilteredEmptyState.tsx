// empty-state-policy: allow — presentational wrapper (Wave A D6); every call
// site renders below its page's settled useLoadGate/isLoading gate and only
// when the UNFILTERED store is nonempty (two-tier rule).
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { useViewScope } from '@/lib/use-view-scope';
import { hiddenClause, type HiddenPartition } from '@/lib/view-scope';

export interface FilteredEmptyStateProps {
  /** Plural noun, e.g. 'loans', 'properties or rentals'. */
  noun: string;
  partition: HiddenPartition;
  jointWord?: string;
  otherVerb?: string;
  /** Overrides for cannot-be-joint declarations (C12). */
  title?: string;
  description?: string;
  /** Drop the Card chrome (forwarded to EmptyState). */
  bare?: boolean;
  className?: string;
}

/**
 * Tier-2 empty state (Copy contract C4/C5): the household HAS rows, the
 * active view hid them all. Count-aware copy + a "View household" action.
 * Deliberately accepts NO children — an Add CTA in a filtered-empty state
 * is the false-onboarding bug this component exists to kill; true-empty
 * call sites keep using EmptyState directly.
 */
export function FilteredEmptyState({
  noun, partition, jointWord, otherVerb, title, description, bare, className,
}: FilteredEmptyStateProps) {
  const { filter, personName, otherName, setFilter } = useViewScope();
  const derivedTitle =
    filter === 'joint' ? `No joint ${noun}` : `No ${noun} in ${personName}'s name`;
  const clause = hiddenClause(partition, { filter, otherName, jointWord, otherVerb });
  const derivedDescription =
    clause.length > 0 ? `${clause.charAt(0).toUpperCase()}${clause.slice(1)} not shown.` : undefined;
  return (
    <EmptyState
      bare={bare}
      className={className}
      title={title ?? derivedTitle}
      description={description ?? derivedDescription}
    >
      <Button variant="outline" size="sm" onClick={() => setFilter('household')}>
        View household
      </Button>
    </EmptyState>
  );
}
