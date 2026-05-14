import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { CalculatorCard } from './CalculatorCard';
import { computeEquityValue } from '@/lib/equity-value';
import { formatCurrency } from '@/lib/format';

interface EquityValueCardProps {
  cardId?: string;
  onHide?: () => void;
}

interface PersonTotal {
  ownerPersonId: number;
  name: string;
  vested: number;
  grantCount: number;
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

  // Group grants by ownerPersonId, summing vestedValue per person. Stable
  // ordering: insertion order (which is grant load order) — keeps the table
  // readable without sorting churn.
  const perPerson = useMemo<PersonTotal[]>(() => {
    const map = new Map<number, PersonTotal>();
    for (const g of equityGrants) {
      const result = computeEquityValue(g, today);
      const personName = personById.get(g.ownerPersonId) ?? 'Unknown';
      const prev = map.get(g.ownerPersonId);
      if (prev) {
        prev.vested += result.vestedValue;
        prev.grantCount += 1;
      } else {
        map.set(g.ownerPersonId, {
          ownerPersonId: g.ownerPersonId,
          name: personName,
          vested: result.vestedValue,
          grantCount: 1,
        });
      }
    }
    return [...map.values()];
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
      <p className="text-sm text-muted-foreground mb-3">
        Total vested across {equityGrants.length}{' '}
        {equityGrants.length === 1 ? 'grant' : 'grants'}.
      </p>
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
              <td className="py-2">{p.name}</td>
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
