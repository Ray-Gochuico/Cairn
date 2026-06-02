import { Link } from 'react-router-dom';
import { CalculatorCard } from './CalculatorCard';

interface BacktestCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function BacktestCard({ cardId, onHide }: BacktestCardProps = {}) {
  return (
    <CalculatorCard
      title="Historical Backtest"
      titleText="Historical Backtest"
      headline="Backtest your portfolio"
      cardId={cardId}
      onHide={onHide}
    >
      <p className="text-sm text-muted-foreground">
        Replay historical market sequences against your current portfolio
        allocation to see how past conditions would have affected your outcomes.
      </p>
      <div className="mt-2">
        <Link
          to="/calculators/backtest"
          aria-label="Open the Historical Backtest tool"
          className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Open the Backtest tool →
        </Link>
      </div>
    </CalculatorCard>
  );
}
