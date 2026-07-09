import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { computeEquityValue, type EquityValueResult } from '@/lib/equity-value';
import { useViewFilter, type ViewFilter } from '@/lib/use-view-filter';
import type { EquityGrant } from '@/types/schema';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import AddEquityGrantDialog from '@/components/equity-grants/AddEquityGrantDialog';
import type { CsvColumn } from '@/lib/csv';
import { formatCurrency } from '@/lib/format';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';

/**
 * EquityGrants page — Phase 3 visualization surface.
 *
 * Pulls from equityGrants + persons stores, derives a `EquityValueResult` per
 * grant via the pure `computeEquityValue` helper. The page surfaces three
 * things:
 *
 *   1. A summary strip of household-wide totals (vested, unvested, monthly
 *      strike cost) so the user gets the big picture at a glance.
 *   2. One card per grant with vesting progress, per-grant totals, and the
 *      next 3 vest dates.
 *   3. Easy access back to /inputs/equity-grants for editing.
 *
 * No Recharts here — a styled `<div>` plays the role of the stacked
 * vested/unvested bar so we keep the page accessible without another dep.
 */

interface GrantProjection {
  grant: EquityGrant;
  ownerName: string;
  result: EquityValueResult;
}

/**
 * EquityGrant.ownerPersonId is non-nullable per the Phase 3 schema (grants
 * are always individual — there's no "joint grant" concept), so we can't
 * reuse the generic `filterByOwnerPersonId` helper without adjusting types.
 * Special-cased inline here: in 'joint' view, return nothing (no grant
 * qualifies); in p1/p2 view, return grants whose ownerPersonId matches.
 */
function filterGrantsByView(
  grants: EquityGrant[],
  filter: ViewFilter,
  persons: { id?: number }[],
): EquityGrant[] {
  if (filter === 'household') return grants;
  if (filter === 'joint') return [];
  const personId = filter === 'p1' ? persons[0]?.id : persons[1]?.id;
  if (personId == null) return [];
  return grants.filter((g) => g.ownerPersonId === personId);
}

interface EquityGrantCardProps {
  projection: GrantProjection;
}

function EquityGrantCard({ projection }: EquityGrantCardProps) {
  const { grant, ownerName, result } = projection;
  const { vestedValue, unvestedValue, monthlyCost, upcomingVestDates } = result;

  const total = vestedValue + unvestedValue;
  // When the grant is worth $0 (e.g. currentFmv = 0), divide-by-zero would
  // give NaN. Default to a fully-vested-looking bar in that case so the user
  // still sees something sensible. The dollar values below will read $0/$0
  // either way.
  const vestedPct = total > 0 ? (vestedValue / total) * 100 : 100;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{grant.name}</span>
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            <span>{grant.companyName}</span>
            <span aria-hidden> · </span>
            <span>{ownerName}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span className="text-success-foreground">
              Vested{' '}
              <span className="tabular-nums">{formatCurrency(vestedValue)}</span>
            </span>
            <span className="text-warning-foreground">
              Unvested{' '}
              <span className="tabular-nums">{formatCurrency(unvestedValue)}</span>
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted flex"
            aria-label={`${grant.name} vesting progress`}
          >
            <div
              className="h-full bg-success"
              style={{ width: `${vestedPct}%` }}
              aria-hidden
            />
            <div
              className="h-full bg-warning"
              style={{ width: `${100 - vestedPct}%` }}
              aria-hidden
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Monthly strike cost
            </dt>
            <dd className="tabular-nums font-medium">
              {formatCurrency(monthlyCost)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Total shares
            </dt>
            <dd className="tabular-nums font-medium">
              {grant.totalShares.toLocaleString()}
            </dd>
          </div>
        </dl>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Upcoming vest dates
          </div>
          {upcomingVestDates.length > 0 ? (
            <ul className="text-sm space-y-1">
              {upcomingVestDates.map((d) => (
                <li key={d} className="tabular-nums">
                  {d}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Fully vested — no remaining vest dates.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EquityGrants() {
  const { filter, persons } = useViewFilter();
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const loadGrants = useEquityGrantsStore((s) => s.load);
  const grantsError = useEquityGrantsStore((s) => s.error);
  const grantsLoading = useEquityGrantsStore((s) => s.isLoading);
  const loadPersons = usePersonsStore((s) => s.load);
  const personsError = usePersonsStore((s) => s.error);
  const personsLoading = usePersonsStore((s) => s.isLoading);

  // Controls the in-page Add Equity Grant dialog. Sits on the page (not in
  // the header div) so opening from the empty-state CTA stays trivial later.
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(() => {
    loadGrants();
    loadPersons();
  }, [loadGrants, loadPersons]);

  const storeErrors = [grantsError, personsError];
  const hasStoreError = storeErrors.some((e) => e != null);

  // W10 M18: gate the empty state behind load settlement — never flash
  // "No equity grants yet" while grants + persons are still loading.
  const gate = useLoadGate([grantsLoading, personsLoading], storeErrors, reload);

  // Apply the view filter — grants are individual (ownerPersonId is
  // non-nullable), so 'joint' produces an empty list.
  const visibleGrants = useMemo(
    () => filterGrantsByView(equityGrants, filter, persons),
    [equityGrants, filter, persons],
  );

  // Stable "today" per render cycle — passed into computeEquityValue so the
  // helper isn't recomputed twice from new Date() drift inside a single
  // render. Recomputed on each commit which is fine for date-precision UI.
  const today = useMemo(() => new Date(), []);

  // Owner name lookup (id is non-nullable on persisted Person rows). Uses the
  // full persons list (from useViewFilter) so we can still resolve names for
  // grants whose owner isn't the currently-selected filter target.
  const personById = useMemo(
    () => new Map(persons.map((p) => [p.id!, p.name])),
    [persons],
  );

  // CSV column map for the Export CSV button. `owner` resolves ownerPersonId
  // to the owning person's name via personById; an id with no matching
  // person renders as an empty cell. vestingSchedule (a JSON array) is not a
  // CSV column. grantDate is already stored as YYYY-MM-DD — passed through.
  const csvColumns = useMemo<CsvColumn<EquityGrant>[]>(
    () => [
      { header: 'name', value: (g) => g.name },
      { header: 'company', value: (g) => g.companyName },
      { header: 'owner', value: (g) => personById.get(g.ownerPersonId) ?? '' },
      { header: 'grant date', value: (g) => g.grantDate },
      { header: 'strike price', value: (g) => g.strikePrice },
      { header: 'total shares', value: (g) => g.totalShares },
      { header: 'current FMV', value: (g) => g.currentFmv },
    ],
    [personById],
  );

  const projections = useMemo<GrantProjection[]>(() => {
    return visibleGrants.map((grant) => ({
      grant,
      ownerName: personById.get(grant.ownerPersonId) ?? 'Unknown',
      result: computeEquityValue(grant, today),
    }));
  }, [visibleGrants, personById, today]);

  const totals = useMemo(() => {
    return projections.reduce(
      (acc, p) => ({
        vested: acc.vested + p.result.vestedValue,
        unvested: acc.unvested + p.result.unvestedValue,
        monthlyCost: acc.monthlyCost + p.result.monthlyCost,
      }),
      { vested: 0, unvested: 0, monthlyCost: 0 },
    );
  }, [projections]);

  if (!gate.settled) {
    return (
      <PageContainer className="space-y-6">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  if (equityGrants.length === 0) {
    return (
      <PageContainer className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Equity Grants</h1>
          <p className="text-sm text-muted-foreground">
            Track equity grants with vesting schedules and see vested/unvested
            value over time.
          </p>
        </div>
        {hasStoreError ? (
          <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        ) : (
          <EmptyState
            icon={Gift}
            title="No equity grants yet"
            description="Add one in Inputs to track vesting progress and value over time."
          >
            <Button asChild>
              <Link to="/inputs/equity-grants">Add your first grant</Link>
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
          <h1 className="text-2xl font-semibold mb-1">Equity Grants</h1>
          <p className="text-sm text-muted-foreground">
            Vesting progress and value across all grants in your household.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add grant
          </Button>
          <ExportCsvButton
            baseName="equity-grants"
            columns={csvColumns}
            rows={equityGrants}
            size="sm"
          />
          <Button asChild variant="outline" size="sm">
            <Link to="/inputs/equity-grants">Manage grants</Link>
          </Button>
        </div>
      </div>

      <div
        data-testid="equity-summary"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm"
      >
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total vested
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {formatCurrency(totals.vested)}
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total unvested
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {formatCurrency(totals.unvested)}
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Monthly strike cost
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {formatCurrency(totals.monthlyCost)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {projections.map((p) => (
          <EquityGrantCard key={p.grant.id} projection={p} />
        ))}
      </div>

      <AddEquityGrantDialog open={addOpen} onOpenChange={setAddOpen} />
    </PageContainer>
  );
}
