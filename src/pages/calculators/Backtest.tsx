import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { useRealState } from '@/components/whatif/useRealState';
import { backtestPlan, type BacktestConfig, type BacktestResult } from '@/lib/backtest';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BacktestParamsForm, BacktestParamsSchema } from '@/components/backtest/BacktestParamsForm';
import BacktestChart from '@/components/backtest/BacktestChart';
import { BelowGoalList } from '@/components/backtest/BelowGoalList';
import { OutcomeSummary } from '@/components/backtest/OutcomeSummary';
import { OutcomeHistogram } from '@/components/backtest/OutcomeHistogram';
import { BacktestDisclosureCallout } from '@/components/backtest/BacktestDisclosureCallout';

export default function Backtest() {
  const gate = useDisclosureGate('backtest');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const real = useRealState();

  // Seed initial portfolio from current Inputs (total investments at start).
  const seededPortfolio = useMemo(() => {
    if (!real) return 1_000_000;
    const inv = Object.values(real.initialInvestmentsByAccount).reduce((a, b) => a + b, 0);
    return Math.max(0, Math.round(inv + real.initialCash)) || 1_000_000;
  }, [real]);

  const [config, setConfig] = useState<BacktestConfig>(() => ({
    initialPortfolio: seededPortfolio,
    annualSpending: Math.round(seededPortfolio * 0.04),
    horizonYears: 30,
    goalAmount: 0,
    strategy: 'bengen',
    stockPct: 0.75,
    variableRate: 0.04,
    minWithdrawal: Math.round(seededPortfolio * 0.032),
    maxWithdrawal: Math.round(seededPortfolio * 0.06),
  }));

  const [result, setResult] = useState<BacktestResult | null>(null);
  // BT-4 — inline validation/engine-error surfacing (NEVER throw to the route
  // errorElement → the whole page would 404). BT-8 — pending flag so the Run
  // button can disable + read "Running…" during the loop.
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  if (gate.state === 'needs-acceptance') {
    return (
      <DisclosureModal
        document={gate.document}
        onAccept={(v) => acceptDisclaimer('backtest', v)}
      />
    );
  }

  // BT-4: validate BEFORE running, and wrap the engine in try/catch. A
  // min>max / NaN / degenerate-portfolio config previously threw straight to
  // the router errorElement (the one Cairn calc that could self-crash, SF-NUM
  // + UX F4). Now an invalid config OR a thrown engine error sets `runError`
  // and renders a calm inline alert; the page survives. A valid run clears it.
  const run = () => {
    if (!real) return;
    const parsed = BacktestParamsSchema.safeParse(config);
    if (!parsed.success) {
      // Surface the first issue's message (schema messages are user-facing).
      setRunError(parsed.error.issues[0]?.message ?? 'Please check your inputs.');
      return;
    }
    setRunError(null);
    // BT-8: paint the pending state, THEN run the (synchronous, ~<1s) loop on
    // the next tick so "Running…" / the disabled button actually render. Mirrors
    // the Investments.tsx pending idiom (flag → deferred compute → clear).
    setIsRunning(true);
    setTimeout(() => {
      try {
        setResult(
          backtestPlan(
            { ...real, initialInvestmentsByAccount: { ...real.initialInvestmentsByAccount } },
            parsed.data,
          ),
        );
      } catch (err) {
        // Defensive: the schema catches the known degenerate inputs, but a
        // future engine path could still throw — keep it off the errorElement.
        setRunError(
          err instanceof Error
            ? err.message
            : 'The backtest could not be run with these inputs.',
        );
      } finally {
        setIsRunning(false);
      }
    }, 0);
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="backtest-page">
      {/* W2 / BT-6 — ONE canonical back-nav markup for every calculator detail
          route (the paycheck detail page has the identical block). Match it
          byte-for-byte here so the two detail pages don't drift. */}
      <Link
        to="/calculators"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to calculators
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Historical Backtest</h1>
        <p className="text-sm text-muted-foreground">
          Replays your plan against every U.S. market starting year from 1871 onward.
          Survival counts are before withdrawal tax — not a tax-inclusive guarantee.
          For side-by-side scenario comparison, see{' '}
          <Link
            to="/what-if"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            What-If →
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <BacktestParamsForm
            initial={config}
            onChange={setConfig}
            onRun={run}
            isRunning={isRunning}
          />
          {runError && (
            // BT-4 — calm inline validation/error surface (mirrors conventions.md
            // §"Validation surfacing"). The run() guard means we NEVER reach the
            // route errorElement, so the page can't 404 on a bad config.
            <div
              role="alert"
              className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
            >
              {runError}
            </div>
          )}
        </CardContent>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Portfolio value over retirement</CardTitle>
            </CardHeader>
            <CardContent>
              <BacktestChart
                result={result}
                goalAmount={config.goalAmount}
                worstStartYear={result.endings.worst.startYear}
              />
              <BelowGoalList result={result} goalAmount={config.goalAmount} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outcome</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OutcomeSummary result={result} goalAmount={config.goalAmount} />
              <OutcomeHistogram result={result} goalAmount={config.goalAmount} />
            </CardContent>
          </Card>
        </>
      ) : (
        // SF-3 — pre-run empty state. Before the first run the results region
        // would otherwise be simply absent (a blank page below the params),
        // reading as broken. Show a quiet prompt instead.
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <div className="font-medium text-foreground">No backtest run yet</div>
            <p className="mt-1">
              Set your plan parameters above, then hit{' '}
              <strong>Run backtest</strong> to replay it against every market
              starting year since 1871.
            </p>
          </CardContent>
        </Card>
      )}

      <BacktestDisclosureCallout />
    </div>
  );
}
