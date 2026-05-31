import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { CalculatorCard } from './CalculatorCard';
import { computeEquityValue } from '@/lib/equity-value';
import { formatCurrency } from '@/lib/format';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { ResultRow } from '@/components/calculators/ResultRow';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import type { GrantType } from '@/types/enums';

interface EquityValueCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

interface PersonTotal {
  ownerPersonId: number;
  name: string;
  vested: number;
  grantCount: number;
  grantTypes: GrantType[];
}

export function EquityValueCard({ cardId, onHide }: EquityValueCardProps = {}) {
  const { equityGrants } = useEquityGrantsStore();
  const { persons } = usePersonsStore();

  // Stable "today" so computeEquityValue isn't fed a fresh Date on every
  // memo recompute when the inputs change.
  const today = useMemo(() => new Date(), []);

  // Owner name lookup (id is non-nullable on persisted Person rows).
  const personById = useMemo(
    () => new Map(persons.map((p) => [p.id!, p.name])),
    [persons],
  );

  // Group grants by ownerPersonId, summing vestedValue per person. Also
  // accumulate totalUnvested and upcoming vest dates across all grants.
  // Stable ordering: insertion order (which is grant load order) — keeps the
  // table readable without sorting churn.
  const { perPerson, totalUnvested, upcomingVests } = useMemo(() => {
    const map = new Map<number, PersonTotal>();
    let totalUnvestedAcc = 0;
    const allUpcomingDates: string[] = [];

    for (const g of equityGrants) {
      const result = computeEquityValue(g, today);
      totalUnvestedAcc += result.unvestedValue;
      for (const d of result.upcomingVestDates) {
        allUpcomingDates.push(d);
      }

      const personName = personById.get(g.ownerPersonId) ?? 'Unknown';
      const prev = map.get(g.ownerPersonId);
      const grantType = g.grantType;
      if (prev) {
        prev.vested += result.vestedValue;
        prev.grantCount += 1;
        if (!prev.grantTypes.includes(grantType)) {
          prev.grantTypes.push(grantType);
        }
      } else {
        map.set(g.ownerPersonId, {
          ownerPersonId: g.ownerPersonId,
          name: personName,
          vested: result.vestedValue,
          grantCount: 1,
          grantTypes: [grantType],
        });
      }
    }

    // Dedupe, sort ascending (ISO date strings sort lexically), take first 3.
    const deduped = [...new Set(allUpcomingDates)].sort().slice(0, 3);

    return {
      perPerson: [...map.values()],
      totalUnvested: totalUnvestedAcc,
      upcomingVests: deduped,
    };
  }, [equityGrants, personById, today]);

  const totalVested = useMemo(
    () => perPerson.reduce((sum, p) => sum + p.vested, 0),
    [perPerson],
  );

  if (equityGrants.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title="Equity Value"
        headline="—"
      >
        <p className="text-sm text-muted-foreground">
          Add equity grants to see vested value across your household.
        </p>
      </CalculatorCard>
    );
  }

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Equity Value"
      headline={
        <span data-testid="equity-value-headline">
          {formatCurrency(totalVested)}
        </span>
      }
    >
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <p className="text-sm text-muted-foreground">
          Total vested across {equityGrants.length}{' '}
          {equityGrants.length === 1 ? 'grant' : 'grants'}.
        </p>
        <FreshnessBadge size="sm" />
      </div>
      <ResultRow
        label="Total vested"
        emphasis
        testId="equity-total-vested"
        value={formatCurrency(totalVested)}
      />
      <ResultRow
        label="Total unvested"
        testId="equity-total-unvested"
        value={formatCurrency(totalUnvested)}
      />
      {upcomingVests.length > 0 && (
        <div
          data-testid="equity-upcoming-vests"
          className="text-xs text-muted-foreground mt-1"
        >
          Next vests: {upcomingVests.join(', ')}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Owner</th>
            <th className="py-2">Grants</th>
            <th className="py-2">Vested value</th>
          </tr>
        </thead>
        <tbody>
          {perPerson.map((p) => (
            <tr
              key={p.ownerPersonId}
              className="border-t"
              data-testid={`equity-person-row-${p.ownerPersonId}`}
            >
              <td className="py-2">
                {p.name}
                {p.grantTypes.map((type) =>
                  type === 'ISO' || type === 'NSO' ? (
                    <TermTooltip key={type} term={type}>
                      <span className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                        {type}
                      </span>
                    </TermTooltip>
                  ) : (
                    <span
                      key={type}
                      className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      {type}
                    </span>
                  ),
                )}
              </td>
              <td className="py-2 tabular-nums">{p.grantCount}</td>
              <td className="py-2 tabular-nums">{formatCurrency(p.vested)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-3 text-sm">
        <Link
          to="/equity-grants"
          className="text-primary underline-offset-4 hover:underline"
        >
          View all →
        </Link>
      </div>
    </CalculatorCard>
  );
}
