/**
 * Historical Backtest — page stub.
 * The full implementation lands in Task 12. This stub mounts at
 * /calculators/backtest and provides the heading + placeholder needed for
 * routing tests and the BacktestCard CTA link target.
 */
export default function Backtest() {
  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Historical Backtest</h1>
      <div data-testid="backtest-stub" className="text-sm text-muted-foreground">
        Full backtest calculator coming soon. This page will let you replay
        historical market sequences against your current portfolio allocation.
      </div>
    </div>
  );
}
