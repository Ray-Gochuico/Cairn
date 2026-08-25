import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useGoalsStore } from '@/stores/goals-store';
import { useHouseholdStore } from '@/stores/household-store';
import { GoalType } from '@/types/enums';
import { formatCurrency } from '@/lib/format';
import { monthYearLabel, type HouseTarget } from '@/domain/interview/threads/home-purchase';

/**
 * "Track this as a Goal" (Appendix A, wave T2): the ONE user-initiated
 * write outside interview_answers + the household write-through — creates
 * a real DOWN_PAYMENT goal via the goals store (the Goals.tsx create
 * idiom). D-HP6: goals have no unique constraint anywhere, so dedup lives
 * HERE — any existing DOWN_PAYMENT goal renders the tracked state instead,
 * the click handler re-checks, and the button disables while pending.
 * Never automatic; renders only under the home_purchase plan reply.
 */
export function HouseGoalCta({ target }: { target: HouseTarget }) {
  const goals = useGoalsStore((s) => s.goals);
  const create = useGoalsStore((s) => s.create);
  const householdId = useHouseholdStore((s) => s.household?.id ?? 1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = goals.find((g) => g.type === GoalType.DOWN_PAYMENT);
  if (existing) {
    return (
      <div className="text-xs text-muted-foreground">
        Tracked as a Goal — {existing.name}.{' '}
        <Link className="underline hover:no-underline" to="/goals">Open Goals →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          setError(null);
          try {
            // Re-check at click time (D-HP6): a concurrent create loses.
            if (useGoalsStore.getState().goals.some((g) => g.type === GoalType.DOWN_PAYMENT)) return;
            await create({
              householdId,
              forPersonId: null,
              name: 'Home down payment',
              type: GoalType.DOWN_PAYMENT,
              targetAmount: target.amountDollars,
              targetDate: `${target.targetMonth}-01`,
              linkedAccountIds: [],
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the goal.');
          } finally {
            setPending(false);
          }
        }}
      >
        Track this as a Goal
      </Button>
      <p className="text-xs text-muted-foreground">
        Creates a {formatCurrency(target.amountDollars)} down-payment goal targeting {monthYearLabel(target.targetMonth)} — link accounts to it on the Goals page to track progress.
      </p>
      {error && (
        <div className="text-xs text-destructive-soft-foreground" role="alert">{error}</div>
      )}
    </div>
  );
}
