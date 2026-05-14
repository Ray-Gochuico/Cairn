import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { computeEquityValue, type EquityValueResult } from '@/lib/equity-value';
import type { EquityGrant } from '@/types/schema';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';

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
            <span aria-hidden>🎁</span>
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
            <span className="text-emerald-700 dark:text-emerald-400">
              Vested{' '}
              <span className="tabular-nums">{formatCurrency(vestedValue)}</span>
            </span>
            <span className="text-amber-700 dark:text-amber-400">
              Unvested{' '}
              <span className="tabular-nums">{formatCurrency(unvestedValue)}</span>
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted flex"
            aria-label={`${grant.name} vesting progress`}
          >
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${vestedPct}%` }}
              aria-hidden
            />
            <div
              className="h-full bg-amber-500"
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
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const loadGrants = useEquityGrantsStore((s) => s.load);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);

  useEffect(() => {
    loadGrants();
    loadPersons();
  }, [loadGrants, loadPersons]);

  // Stable "today" per render cycle — passed into computeEquityValue so the
  // helper isn't recomputed twice from new Date() drift inside a single
  // render. Recomputed on each commit which is fine for date-precision UI.
  const today = useMemo(() => new Date(), []);

  // Owner name lookup (id is non-nullable on persisted Person rows).
  const personById = useMemo(
    () => new Map(persons.map((p) => [p.id!, p.name])),
    [persons],
  );

  const projections = useMemo<GrantProjection[]>(() => {
    return equityGrants.map((grant) => ({
      grant,
      ownerName: personById.get(grant.ownerPersonId) ?? 'Unknown',
      result: computeEquityValue(grant, today),
    }));
  }, [equityGrants, personById, today]);

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

  if (equityGrants.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Equity Grants</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Track equity grants with vesting schedules and see vested/unvested
          value over time.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <div>No equity grants yet — add one in Inputs.</div>
            <Button asChild>
              <Link to="/inputs/equity-grants">Add your first grant</Link>
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
          <h1 className="text-2xl font-semibold mb-1">Equity Grants</h1>
          <p className="text-sm text-muted-foreground">
            Vesting progress and value across all grants in your household.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/inputs/equity-grants">Manage grants</Link>
        </Button>
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
    </div>
  );
}
