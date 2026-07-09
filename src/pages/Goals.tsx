import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import {
  CreditCard,
  GraduationCap,
  Home,
  LifeBuoy,
  Palmtree,
  Target,
  type LucideIcon,
} from 'lucide-react';
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
import { formatCurrency, formatPercent, formatDate } from '@/lib/format';
import { minusMonths } from '@/lib/growth-horizons';
import { UpdateAccountBalanceDialog } from '@/components/dialogs/UpdateAccountBalanceDialog';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import type { CsvColumn } from '@/lib/csv';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';

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
 *     Mirrors FinancialIndependenceCard's resolution so the two pages agree on one default.
 */

// Lucide-icon mapping for goal types. Replaces the prior emoji vocabulary
// (Design Wave-3 must-have #5): the sidebar already moved to lucide; the
// goal-type icons survived in this surface + Dashboard mirror. lucide
// gives consistent stroke width, font-fallback safety, and SVG-rendered
// crispness at every size.
const TYPE_ICONS: Record<GoalType, LucideIcon> = {
  [GoalType.RETIREMENT]: Palmtree,
  [GoalType.DOWN_PAYMENT]: Home,
  [GoalType.DEBT_PAYOFF]: CreditCard,
  [GoalType.EDUCATION]: GraduationCap,
  [GoalType.EMERGENCY_FUND]: LifeBuoy,
  [GoalType.GENERIC]: Target,
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
  const cutoffIso = minusMonths(today, monthsBack);
  const linkedSet = new Set(linkedIds);
  const total = contributions
    .filter((c) => linkedSet.has(c.accountId) && c.date >= cutoffIso)
    .reduce((sum, c) => sum + c.amount, 0);
  return total / monthsBack;
}

/**
 * Pick the growth rate to project against. Prefers an entry labelled
 * "Moderate" (matches FinancialIndependenceCard); falls back to the 2nd entry, then the 1st,
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
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-success-soft text-success-foreground">
      On track
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning-soft text-warning-foreground">
      Off track
    </span>
  );

  // Wave-9 M23: display the growth-aware figure — the same r/n basis the
  // on-track badge compounds at (the flat linear figure contradicted it).
  // Can be Infinity when target_date <= today and the goal isn't met; show
  // "—" in that case so the card stays readable.
  const monthlyNeededDisplay = Number.isFinite(projection.monthlyNeededWithGrowth)
    ? formatCurrency(projection.monthlyNeededWithGrowth)
    : '—';

  // Resolve the lucide icon for this goal type; default to the generic
  // Target icon if a new GoalType is added without a mapping.
  const Icon = TYPE_ICONS[goal.type] ?? Target;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{goal.name}</span>
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            {GOAL_TYPE_LABELS[goal.type]} · target{' '}
            <span className="tabular-nums">{formatCurrency(goal.targetAmount)}</span>{' '}
            by {formatDate(goal.targetDate)}
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
                  ? 'h-full bg-success transition-all'
                  : 'h-full bg-warning transition-all'
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
            <dd className="tabular-nums font-medium">{monthlyNeededDisplay}</dd>
            <dd className="text-xs text-muted-foreground mt-0.5">
              at your growth scenario · vs <span className="tabular-nums">{formatCurrency(projection.recentMonthlyContribution)}</span> recent
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
                          ? `updated ${formatDate(info.lastUpdated)}`
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
  const goalsError = useGoalsStore((s) => s.error);
  const goalsLoading = useGoalsStore((s) => s.isLoading);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);
  const snapshotsLoading = useSnapshotsStore((s) => s.isLoading);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const contributionsError = useContributionsStore((s) => s.error);
  const contributionsLoading = useContributionsStore((s) => s.isLoading);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const householdError = useHouseholdStore((s) => s.error);
  const householdLoading = useHouseholdStore((s) => s.isLoading);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const holdingsError = useHoldingsStore((s) => s.error);
  const holdingsLoading = useHoldingsStore((s) => s.isLoading);

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
  // `reload` is also the Retry handler for the store-error banner.
  const reload = useCallback(() => {
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

  // Any consumed store that failed to load. Surfaced as a banner above the
  // page body so a load failure reads as a recoverable hiccup, not vanished
  // data — and the empty-state copy below is suppressed when this is set.
  const storeErrors = [
    goalsError,
    accountsError,
    snapshotsError,
    contributionsError,
    householdError,
    holdingsError,
  ];
  const hasStoreError = storeErrors.some((e) => e != null);

  // W10 T1: never flash "No goals yet" while the loads are in flight.
  const gate = useLoadGate(
    [goalsLoading, accountsLoading, snapshotsLoading, contributionsLoading, householdLoading, holdingsLoading],
    storeErrors,
    reload,
  );

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

  // Person-name lookup for the CSV `for` column. Built from the full persons
  // list (from useViewFilter) so every goal's forPersonId resolves regardless
  // of the current view filter. Persisted Person rows always have an id.
  const personById = useMemo(
    () =>
      new Map(
        persons.filter((p) => p.id != null).map((p) => [p.id as number, p.name]),
      ),
    [persons],
  );

  // CSV column map for the Export CSV button. `type` uses the existing
  // GOAL_TYPE_LABELS map; `for` resolves forPersonId to a person name (a null
  // id or an id with no matching person renders as an empty cell).
  // linkedAccountIds (an array) is not a CSV column. targetDate is already
  // stored as YYYY-MM-DD — passed through.
  const csvColumns = useMemo<CsvColumn<Goal>[]>(
    () => [
      { header: 'name', value: (g) => g.name },
      { header: 'type', value: (g) => GOAL_TYPE_LABELS[g.type] },
      { header: 'target amount', value: (g) => g.targetAmount },
      { header: 'target date', value: (g) => g.targetDate },
      {
        header: 'for',
        value: (g) => (g.forPersonId == null ? '' : personById.get(g.forPersonId) ?? ''),
      },
    ],
    [personById],
  );

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

  if (!gate.settled) {
    return (
      <PageContainer className="space-y-6">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  if (goals.length === 0) {
    return (
      <PageContainer className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Goals</h1>
          <p className="text-sm text-muted-foreground">
            Track financial milestones and see whether you're on track to hit them.
          </p>
        </div>
        {/*
         * Distinguish "empty because new" from "empty because the load failed":
         * if a consumed store errored, show the recoverable banner instead of
         * the friendly empty-state CTA (which would wrongly imply the user has
         * no goals when their data merely failed to load).
         */}
        {hasStoreError ? (
          <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        ) : (
          <EmptyState icon={Target} title="No goals yet" description="Add one in Inputs to start tracking your financial milestones.">
            <Button asChild>
              <Link to="/inputs/goals">Add your first goal</Link>
            </Button>
          </EmptyState>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Goals</h1>
          <p className="text-sm text-muted-foreground">
            Projections use the last 6 months of contributions and the Moderate
            growth scenario ({(annualRate * 100).toFixed(1)}%).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton baseName="goals" columns={csvColumns} rows={goals} size="sm" />
          <Button asChild variant="outline" size="sm">
            <Link to="/inputs/goals">Manage goals</Link>
          </Button>
        </div>
      </div>

      {visibleGoals.length === 0 ? (
        // W10 T7: goals exist, but the person filter strips them all — explain
        // instead of a silent header over an empty grid.
        <EmptyState
          bare
          icon={Target}
          title="No goals in this view"
          description="Every goal belongs to someone else under this filter — switch to Household to see everything."
        />
      ) : (
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
      )}

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
    </PageContainer>
  );
}
