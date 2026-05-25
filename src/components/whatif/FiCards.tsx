import { Card, CardContent } from '@/components/ui/card';
import { coastFi } from '@/lib/coast-fi';
import { currentAge } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import type { MonthlyState } from '@/lib/scenarios';
import type { Household, Person } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

export interface FiCardsProps {
  scenarios: Scenario[];
  projections: Map<number, MonthlyState[]>;
  household: Household;
  persons: Person[];
}

interface ComputedRow {
  liquidNw: number;
  fireTarget: number;
  coastFiTarget: number;
  yearsUntilRetirement: number;
  rate: number;
  rateLabel: string;
}

function pickReferenceScenario(scenarios: Scenario[]): Scenario | null {
  const visible = scenarios.filter((s) => s.visible);
  return (
    visible.find((s) => s.isActive) ??
    visible.find((s) => s.isBaseline) ??
    visible[0] ??
    null
  );
}

function pickRate(household: Household): { rate: number; label: string } | null {
  const list = household.growthScenarios;
  if (!list || list.length === 0) return null;
  const moderate = list.find((s) => s.label.toLowerCase() === 'moderate');
  const pick = moderate ?? list[Math.min(1, list.length - 1)] ?? list[0];
  return { rate: pick.rate, label: pick.label };
}

function computeCards(props: FiCardsProps): ComputedRow | null {
  const { scenarios, projections, household, persons } = props;
  if (!household || persons.length === 0) return null;
  if (household.withdrawalRate <= 0) return null;
  const rate = pickRate(household);
  if (!rate) return null;

  const ref = pickReferenceScenario(scenarios);
  if (!ref || ref.id == null) return null;
  const states = projections.get(ref.id);
  if (!states || states.length === 0) return null;
  const seed = states[0];

  const liquidNw = seed.investments + seed.cash;
  const fireTarget = (household.monthlyExpenseBaseline * 12) / household.withdrawalRate;

  const yearsByPerson = persons.map(
    (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
  );
  const yearsUntilRetirement = Math.max(0, Math.min(...yearsByPerson));

  const coastFiTarget = coastFi({
    requiredAtRetirement: fireTarget,
    annualRate: rate.rate,
    yearsUntilRetirement,
  });

  return {
    liquidNw,
    fireTarget,
    coastFiTarget,
    yearsUntilRetirement,
    rate: rate.rate,
    rateLabel: rate.label,
  };
}

interface FiCardProps {
  testId: string;
  title: string;
  target: number;
  liquidNw: number;
  explainer: string;
}

function FiCard({ testId, title, target, liquidNw, explainer }: FiCardProps) {
  const pct = target > 0 ? (liquidNw / target) * 100 : 0;
  return (
    <Card className="min-w-0 flex-1" data-testid={testId}>
      <CardContent className="py-4">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="text-xl sm:text-2xl font-semibold tabular-nums break-words">
          {formatCurrency(target)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{explainer}</div>
        <div className="mt-2 text-xs tabular-nums" data-testid={`${testId}-progress`}>
          {formatCurrency(liquidNw)} / {formatCurrency(target)} ·{' '}
          <span className="font-medium">{pct.toFixed(0)}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FiCards(props: FiCardsProps) {
  const computed = computeCards(props);
  if (!computed) return null;

  const { liquidNw, fireTarget, coastFiTarget, yearsUntilRetirement, rate, rateLabel } = computed;
  const ratePct = (rate * 100).toFixed(1);
  const withdrawalPct = (props.household.withdrawalRate * 100).toFixed(1);

  return (
    <div
      className="flex flex-col sm:flex-row gap-3"
      data-testid="whatif-fi-cards"
    >
      <FiCard
        testId="whatif-fire-number"
        title="FIRE number"
        target={fireTarget}
        liquidNw={liquidNw}
        explainer={`Portfolio at retirement (${withdrawalPct}% rule)`}
      />
      <FiCard
        testId="whatif-coastfi-number"
        title="Coast FI target today"
        target={coastFiTarget}
        liquidNw={liquidNw}
        explainer={`${rateLabel} ${ratePct}% growth, ${yearsUntilRetirement}y to retirement`}
      />
    </div>
  );
}
