import { CalculatorCard } from './CalculatorCard';
import { InlineLink } from '@/components/calculators/InlineLink';

interface BacktestCardProps {
  cardId?: string;
}

export function BacktestCard({ cardId }: BacktestCardProps = {}) {
  return (
    <CalculatorCard
      title="Historical Backtest"
      titleText="Historical Backtest"
      headline="Backtest your portfolio"
      cardId={cardId}
      meaning="Replay historical market sequences against your current allocation."
    >
      <p className="text-sm text-muted-foreground">
        Replay historical market sequences against your current portfolio
        allocation to see how past conditions would have affected your outcomes.
      </p>
      <div className="mt-2">
        <InlineLink
          to="/calculators/backtest"
          aria-label="Open the Historical Backtest tool"
          className="text-sm"
        >
          Open the Backtest tool →
        </InlineLink>
      </div>
    </CalculatorCard>
  );
}
