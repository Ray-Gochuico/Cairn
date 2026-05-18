import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGoalsStore } from '@/stores/goals-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import {
  computeGoalProgress,
  type GoalProgressResult,
} from '@/lib/goal-progress';
import { filterByForPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { GOAL_TYPE_LABELS } from '@/components/forms/GoalForm';
import { GoalType } from '@/types/enums';
import type {
  AccountSnapshot,
  Contribution,
  Goal,
  Household,
} from '@/types/schema';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatPercent } from '@/lib/format';
import { UpdateAccountBalanceDialog } from '@/components/dialogs/UpdateAccountBalanceDialog';

/**
 * Goals page — Phase 3 visualization surface.
 *
 * Pulls from goals/accounts/snapshots/contributions/household stores, then
 * derives a per-goal `GoalProgressResult` via the pure `computeGoalProgress`
 * helper. No Recharts here — a styled `<div>` plays the role of the progress
 * bar so we keep the page accessible without pulling another dep.
 *
 *   - currentSaved: Σ(latest snapshot per accountId in linkedAccountIds)
 *   - recentMonthlyContribution: 6-month rolling contribution average across
 *     the same linked accounts (matches the "recent flow" the user actually
 *     experiences in the Monthly mini-window).
 *   - growth rate: pulled from household.growthScenarios — prefer the entry
 *     labelled "Moderate", then the second entry, then the first, then 6%.
 *     Mirrors FireCard's resolution so the two pages agree on one default.
 */

const TYPE_ICONS: Record<GoalType, string> = {
  [GoalType.RETIREMENT]: '🏖️',
  [GoalType.DOWN_PAYMENT]: '🏠',
  [GoalType.DEBT_PAYOFF]: '💳',
  [GoalType.EDUCATION]: '🎓',
  [GoalType.EMERGENCY_FUND]: '🛟',
  [GoalType.GENERIC]: '🎯',
};

/**
 * Walk all snapshots once and keep the max-by-date entry per accountId. ISO
 * date strings sort lexicographically the same as chronologically, so a
 * string compare is sufficient. Returns a plain map of accountId -> value
 * (the date is dropped once we've picked a winner).
 */
function latestSnapshotPerAccount(snapshots: AccountSnapshot[]): Map<number, number> {
  const winner = new Map<number, { date: string; value: number }>();
  for (const s of snapshots) {
    const prev = winner.get(s.accountId);
    if (!prev || s.snapshotDate > prev.date) {
      winner.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
    }
  }
  return new Map([...winner.entries()].map(([k, v]) => [k, v.value]));
}

/**
 * Average monthly contribution to a set of accounts over the last `monthsBack`
 * months. We sum contributions whose date falls within the window and divide
 * by `monthsBack` — months with no contributions still count as 0, so a one-
 * off $6k deposit averages to $1k/mo over 6 months.
 */
function monthlyContributionAvg(
  contributions: Contribution[],
  linkedIds: number[],
  today: Date,
  monthsBack = 6,
): number {
  if (linkedIds.length === 0 || monthsBack <= 0) return 0;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const linkedSet = new Set(linkedIds);
  const total = contributions
    .filter((c) => linkedSet.has(c.accountId) && c.date >= cutoffIso)
    .reduce((sum, c) => sum + c.amount, 0);
  return total / monthsBack;
}

/**
 * Pick the growth rate to project against. Prefers an entry labelled
 * "Moderate" (matches FireCard); falls back to the 2nd entry, then the 1st,
 * then 6% if the household has no scenarios at all. Defensive defaults
 * matter here because the page renders before household.load() resolves.
 */
function pickModerateRate(household: Household | null): number {
  const FALLBACK = 0.06;
  if (!household || household.growthScenarios.length === 0) return FALLBACK;
  const moderate = household.growthScenarios.find((s) => s.label === 'Moderate');
  if (moderate) return moderate.rate;
  const second = household.growthScenarios[1];
  if (second) return second.rate;
  return household.growthScenarios[0]?.rate ?? FALLBACK;
}

interface GoalProjection extends GoalProgressResult {
  goal: Goal;
  recentMonthlyContribution: number;
}

interface LinkedAccountInfo {
  name: string;
  lastUpdated: string | null;
  hasHoldings: boolean;
}

interface GoalProgressCardProps {
  projection: GoalProjection;
  accountInfoById: Map<number, LinkedAccountInfo>;
  onUpdateBalance: (accountId: number, accountName: string) => void;
}

function GoalProgressCard({
  projection,
  accountInfoById,
  onUpdateBalance,
}: GoalProgressCardProps) {
  const { goal } = projection;
  // Clamp the visual width to [0, 1]; aria-valuenow follows the same clamp so
  // an over-funded goal reads as "100" instead of e.g. "150" (still labelled
  // on-track, but the bar can't visually overflow).
  const pct = Math.min(1, Math.max(0, projection.percentComplete));
  const valuenow = Math.round(pct * 100);

  const onTrackBadge = projection.onTrack ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
      On track
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
      Off track
    </span>
  );

  // linearMonthlyNeeded can be Infinity when target_date <= today and the
  // goal isn't met. Show "—" in that case so the card stays readable.
  const linearMonthlyDisplay = Number.isFinite(projection.linearMonthlyNeeded)
    ? formatCurrency(projection.linearMonthlyNeeded)
    : '—';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base flex items-center gap-2">
            <span aria-hidden>{TYPE_ICONS[goal.type] ?? '🎯'}</span>
            <span className="truncate">{goal.name}</span>
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            {GOAL_TYPE_LABELS[goal.type]} · target{' '}
            <span className="tabular-nums">{formatCurrency(goal.targetAmount)}</span>{' '}
            by {goal.targetDate}
          </div>
        </div>
        {onTrackBadge}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>
              <span className="tabular-nums">{formatCurrency(projection.currentSaved)}</span> saved
            </span>
            <span className="tabular-nums">{formatPercent(projection.percentComplete)}</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={valuenow}
            aria-label={`${goal.name} progress`}
          >
            <div
              className={
                projection.onTrack
                  ? 'h-full bg-emerald-500 transition-all'
                  : 'h-full bg-amber-500 transition-all'
              }
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Monthly needed
            </dt>
            <dd className="tabular-nums font-medium">{linearMonthlyDisplay}</dd>
            <dd className="text-xs text-muted-foreground mt-0.5">
              vs <span className="tabular-nums">{formatCurrency(projection.recentMonthlyContribution)}</span> recent
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Projected at target
            </dt>
            <dd className="tabular-nums font-medium">
              {formatCurrency(projection.projectedAtTarget)}
            </dd>
            <dd className="text-xs text-muted-foreground mt-0.5">
              {projection.monthsUntilTarget} mo to target
            </dd>
          </div>
        </dl>

        {goal.linkedAccountIds.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Linked accounts
            </div>
            <ul className="space-y-1.5">
              {goal.linkedAccountIds.map((accountId) => {
                const info = accountInfoById.get(accountId);
                // Account may have been deleted while still referenced in
                // linkedAccountIds — skip the row rather than crash.
                if (!info) return null;
                return (
                  <li
                    key={accountId}
                    className="flex items-center justify-between text-xs gap-2"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{info.name}</span>
                      <span className="text-muted-foreground ml-2">
                        {info.lastUpdated
                          ? `updated ${info.lastUpdated}`
                          : 'never updated'}
                      </span>
                    </span>
                    {info.hasHoldings ? (
                      <span className="text-muted-foreground italic shrink-0">
                        auto from prices
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUpdateBalance(accountId, info.name)}
                        className="text-primary hover:underline shrink-0"
                      >
                        Update
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Goals() {
  const { filter, persons } = useViewFilter();
  const goals = useGoalsStore((s) => s.goals);
  const loadGoals = useGoalsStore((s) => s.load);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);

  // Tracks which account the UpdateAccountBalanceDialog is currently editing;
  // null means the dialog is closed. We keep both the id and the name in
  // state so the dialog can render its title without re-querying accounts.
  const [dialogTarget, setDialogTarget] = useState<{
    accountId: number;
    accountName: string;
  } | null>(null);

  // Filter goals by the household / p1 / p2 / joint dropdown. Snapshots and
  // contributions intentionally aren't pre-filtered here — the goal already
  // declares its linked accounts via `linkedAccountIds`, so the
  // `computeGoalProgress` derivations naturally scope to those accounts.
  const visibleGoals = useMemo(
    () => filterByForPersonId(goals, filter, persons),
    [goals, filter, persons],
  );

  // Goals page also reads accounts so the side-effect loads keep accounts
  // warm for downstream linking, but the projection itself doesn't need
  // anything beyond ID lookups already handled via snapshots/contributions.
  useEffect(() => {
    loadGoals();
    loadAccounts();
    loadSnapshots();
    loadContributions();
    loadHousehold();
    loadHoldings();
  }, [
    loadGoals,
    loadAccounts,
    loadSnapshots,
    loadContributions,
    loadHousehold,
    loadHoldings,
  ]);

  // Stable "today" per render cycle — passed into computeGoalProgress so the
  // helper isn't recomputed twice from new Date() drift inside a single
  // render. Recomputed on each commit which is fine for a date-precision UI.
  const today = useMemo(() => new Date(), []);

  const annualRate = useMemo(() => pickModerateRate(household), [household]);

  // Map<accountId, info> consumed by each card's "Linked accounts" footer.
  // We compute it once at the page level rather than per-card so the O(N*M)
  // snapshot scan happens only when one of the source arrays actually
  // changes (rather than every card render).
  const accountInfoById = useMemo(() => {
    const map = new Map<number, LinkedAccountInfo>();
    for (const a of accounts) {
      if (a.id == null) continue;
      // Walk all snapshots once per account; ISO dates compare lexically.
      let lastUpdated: string | null = null;
      for (const s of snapshots) {
        if (s.accountId === a.id && (lastUpdated === null || s.snapshotDate > lastUpdated)) {
          lastUpdated = s.snapshotDate;
        }
      }
      const hasHoldings = holdings.some((h) => h.accountId === a.id);
      map.set(a.id, { name: a.name, lastUpdated, hasHoldings });
    }
    return map;
  }, [accounts, snapshots, holdings]);

  const projections = useMemo<GoalProjection[]>(() => {
    const latestMap = latestSnapshotPerAccount(snapshots);
    return visibleGoals.map((g) => {
      const currentSaved = g.linkedAccountIds.reduce(
        (sum, id) => sum + (latestMap.get(id) ?? 0),
        0,
      );
      const recentMonthlyContribution = monthlyContributionAvg(
        contributions,
        g.linkedAccountIds,
        today,
        6,
      );
      const result = computeGoalProgress({
        targetAmount: g.targetAmount,
        targetDate: g.targetDate,
        currentSaved,
        recentMonthlyContribution,
        annualGrowthRate: annualRate,
        today,
      });
      return { goal: g, recentMonthlyContribution, ...result };
    });
  }, [visibleGoals, snapshots, contributions, today, annualRate]);

  if (visibleGoals.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Goals</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Track financial milestones and see whether you're on track to hit them.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <div>No goals yet — set one up in Inputs.</div>
            <Button asChild>
              <Link to="/inputs/goals">Add your first goal</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Goals</h1>
          <p className="text-sm text-muted-foreground">
            Projections use the last 6 months of contributions and the Moderate
            growth scenario ({(annualRate * 100).toFixed(1)}%).
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/inputs/goals">Manage goals</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {projections.map((p) => (
          <GoalProgressCard
            key={p.goal.id}
            projection={p}
            accountInfoById={accountInfoById}
            onUpdateBalance={(accountId, accountName) =>
              setDialogTarget({ accountId, accountName })
            }
          />
        ))}
      </div>

      {dialogTarget && (
        <UpdateAccountBalanceDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogTarget(null);
          }}
          accountId={dialogTarget.accountId}
          accountName={dialogTarget.accountName}
        />
      )}
    </div>
  );
}
