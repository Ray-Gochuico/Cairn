import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { useRealState } from '@/components/whatif/useRealState';
import { backtestPlan, type BacktestConfig, type BacktestResult } from '@/lib/backtest';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BacktestParamsForm, BacktestParamsSchema } from '@/components/backtest/BacktestParamsForm';
import BacktestChart from '@/components/backtest/BacktestChart';
import { BelowGoalList } from '@/components/backtest/BelowGoalList';
import { OutcomeSummary } from '@/components/backtest/OutcomeSummary';
import { OutcomeHistogram } from '@/components/backtest/OutcomeHistogram';
import { BacktestDisclosureCallout } from '@/components/backtest/BacktestDisclosureCallout';
import { InlineLink } from '@/components/calculators/InlineLink';
import { writeLastBacktestRun } from '@/lib/backtest/last-run';

/**
 * Wave 18 C9 — the today's-dollars promotion is a COMPONENT chip (rendered
 * next to Run and atop the results). Constraint 4: the versioned backtest
 * disclosure BODY in src/legal/disclosures.ts is deliberately NOT edited
 * (return-basis disclosure edits require a version bump — so we don't).
 */
const TodaysDollarsChip = () => (
  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
    All figures in today&#39;s dollars
  </span>
);

export default function Backtest() {
  const gate = useDisclosureGate('backtest');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const real = useRealState();

  // W16: the scenario prefills read accounts + snapshots; a cold deep-link to
  // /calculators/backtest would otherwise seed from empty stores. Idempotent —
  // and page-side per D11 (the shared hook never loads stores; boot-loop gotcha).
  useEffect(() => {
    void useAccountsStore.getState().load();
    void useSnapshotsStore.getState().load();
  }, []);

  const scenario = useScenarioAssumptions();

  // Legacy fallback seed (pre-W16 behavior): projection-seed investments +
  // cash, else $1M — used only while the shared scenario has no portfolio.
  const legacyPortfolio = useMemo(() => {
    if (!real) return 1_000_000;
    const inv = Object.values(real.initialInvestmentsByAccount).reduce((a, b) => a + b, 0);
    return Math.max(0, Math.round(inv + real.initialCash)) || 1_000_000;
  }, [real]);
  // C9: the same expression whose `|| 1_000_000` fallback seeds the config —
  // when Inputs has no portfolio value the plan on screen is an EXAMPLE.
  const usingExample =
    !real ||
    Math.round(
      Object.values(real.initialInvestmentsByAccount).reduce((a, b) => a + b, 0) +
        real.initialCash,
    ) <= 0;

  // W16 (D12): seed from the shared scenario — portfolio from the bar's
  // FI-eligible figure; spending from HOUSEHOLD EXPENSES (monthlyExpenses × 12),
  // killing the old 4%-of-portfolio circularity. A $0-expenses household falls
  // back to the 4% heuristic (a $0-spending backtest is degenerate: every
  // start year trivially survives). Spending seeds NEVER read swr/return/
  // inflation — the backtest replays historical returns and CPI.
  const expensesSeeded = scenario.engine.annualExpenses > 0;
  const seeded = useMemo<BacktestConfig>(() => {
    const portfolio =
      scenario.engine.portfolio > 0 ? Math.round(scenario.engine.portfolio) : legacyPortfolio;
    const spending = expensesSeeded
      ? Math.round(scenario.engine.annualExpenses)
      : Math.round(portfolio * 0.04);
    return {
      initialPortfolio: portfolio,
      annualSpending: spending,
      horizonYears: 30,
      goalAmount: 0,
      strategy: 'bengen',
      stockPct: 0.75,
      variableRate: 0.04,
      minWithdrawal: Math.round(portfolio * 0.032),
      maxWithdrawal: Math.round(portfolio * 0.06),
    };
  }, [scenario.engine.portfolio, scenario.engine.annualExpenses, expensesSeeded, legacyPortfolio]);

  // Until the user edits a param, the live config IS the seed (re-seeds on
  // hydration); the first onChange freezes ownership with the user forever.
  const [configEdited, setConfigEdited] = useState(false);
  const [userConfig, setUserConfig] = useState<BacktestConfig>(seeded);
  const config = configEdited ? userConfig : seeded;

  // Remount the params form (it clones `initial` into local state once) when
  // the SEED changes while un-edited. The key is held in a ref and stops
  // updating on first edit — so the unedited→edited transition itself never
  // remounts (no focus loss mid-keystroke).
  const formKeyRef = useRef('seed-init');
  if (!configEdited) {
    formKeyRef.current = `seed-${seeded.initialPortfolio}-${seeded.annualSpending}`;
  }

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
        const r = backtestPlan(
          { ...real, initialInvestmentsByAccount: { ...real.initialInvestmentsByAccount } },
          parsed.data,
        );
        setResult(r);
        // C9/D3: persist the verdict for the collapsed waymark (fail-soft
        // cache; the record carries the producing config for display/debug).
        writeLastBacktestRun({
          v: 1,
          runAt: new Date().toISOString(),
          goalMetCount: r.goalMetCount,
          startYearsCount: r.startYears.count,
          survivedCount: r.survivedCount,
          config: parsed.data as Record<string, unknown>,
        });
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

  // BT-15 — page-level live region. Live regions that are inserted into the DOM
  // WITH their content already present are unreliably announced; a region that
  // is pre-mounted empty (from the first render) and only later has its text set
  // fires dependably. The results subtree mounts all at once, so we announce the
  // headline verdict from here instead of relying on OutcomeSummary's own status.
  const announcement = result
    ? `${Math.round(
        result.startYears.count > 0
          ? (result.goalMetCount / result.startYears.count) * 100
          : 0,
      )}% of ${result.startYears.count} historical periods met your goal`
    : '';

  return (
    <div className="space-y-4 min-w-0" data-testid="backtest-page">
      {/* BT-15 — pre-mounted sr-only announcer (empty until a run completes). */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="backtest-announcer">
        {announcement}
      </div>
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
          Backtest asks &ldquo;would this plan have survived history?&rdquo; — What-If asks
          &ldquo;what changes if I pull a lever?&rdquo;.
          Survival counts are before withdrawal tax — not a tax-inclusive guarantee.
          For side-by-side scenario comparison, see{' '}
          <InlineLink
 to="/what-if">
            What-If →
          </InlineLink>
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle className="text-base">Plan parameters</CardTitle>
            {/* C9: honesty badge — the config fell back to the $1M example
                seed because Inputs holds no portfolio data. */}
            {usingExample && (
              <span className="text-xs text-muted-foreground" data-testid="backtest-example-badge">
                example plan — add Inputs to use your data
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!configEdited && (
            <p className="text-xs text-muted-foreground mb-3" data-testid="backtest-seed-note">
              {expensesSeeded
                ? 'Seeded from your scenario — starting portfolio and annual spending (monthly expenses × 12) follow the calculators scenario bar until you edit a field here.'
                : 'Seeded from your scenario portfolio; annual spending defaults to 4% of it (set a monthly expense baseline in Inputs to seed spending from your real expenses).'}
            </p>
          )}
          <BacktestParamsForm
            key={formKeyRef.current}
            initial={config}
            onChange={(cfg) => {
              setConfigEdited(true);
              setUserConfig(cfg);
            }}
            onRun={run}
            isRunning={isRunning}
          />
          {/* C9: return-basis promotion beside the Run affordance (component
              copy — the versioned legal disclosure body is untouched). */}
          <div className="mt-3">
            <TodaysDollarsChip />
          </div>
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
          {/* C9: the chip repeats at the top of the results block. */}
          <div>
            <TodaysDollarsChip />
          </div>
          {/* BT-15 — the answer above the fold: the Outcome card (success rate +
              distribution) leads, so the verdict is the first thing rendered
              after the params. The chart (with its BelowGoalList annotation)
              follows as supporting detail. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outcome</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OutcomeSummary result={result} goalAmount={config.goalAmount} />
              <OutcomeHistogram result={result} goalAmount={config.goalAmount} />
            </CardContent>
          </Card>
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
