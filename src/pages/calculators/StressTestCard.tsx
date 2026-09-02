import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalculatorCard, EmptyMeaning, RailReset } from './CalculatorCard';
import { NumberField } from '@/components/calculators/NumberField';
import { InlineLink } from '@/components/calculators/InlineLink';
import { ResultRow } from '@/components/calculators/ResultRow';
import { InlineChart } from '@/components/charts/InlineChart';
import { ScopeExclusionsLine } from '@/components/calculators/ScopeExclusionsLine';
import { useCalculatorState } from '@/lib/calculator-state';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { useCalcScope } from '@/lib/calculators/use-calc-scope';
import { realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { pctFromFraction } from '@/lib/calculators/scenario-assumptions';
import { DEFAULT_STOCK_PCT, datasetReplayRows, flatPathEnd, replayWindow } from '@/lib/backtest/replay';
import { STRESS_WINDOWS } from '@/lib/backtest/windows';
import { readLastBacktestRun } from '@/lib/backtest/last-run';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { withViewSearch } from '@/lib/view-scope';
import { formatCurrency, formatPercent, formatSignedCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type StressMode = 'KEEP' | 'PORTFOLIO';
const MODE_KEY = 'calc-mode:stress-test'; // view-state, the usePathMode idiom (DP-5)
const WINDOW_KEY = 'calc-window:stress-test'; // view-state, literal-validated

// PathToFiCard's segmented-control constants, copied verbatim (third copy
// accepted this wave; extraction chip filed — W5's DollarBasisToggle circles
// this area).
const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const SEG_BTN_ACTIVE = 'bg-primary text-primary-foreground';

function readMode(): StressMode {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'PORTFOLIO' ? 'PORTFOLIO' : 'KEEP';
  } catch {
    return 'KEEP';
  }
}

function readWindowId(): string {
  try {
    const raw = sessionStorage.getItem(WINDOW_KEY);
    return STRESS_WINDOWS.some((w) => w.id === raw) ? (raw as string) : STRESS_WINDOWS[0].id;
  } catch {
    return STRESS_WINDOWS[0].id;
  }
}

/** F5: seed from the last Backtest run's config when it carries a valid 0..1 stockPct. */
function seededStockPct(): { pct: number; fromLastRun: boolean } {
  const raw = readLastBacktestRun()?.config['stockPct'];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
    return { pct: Math.round(raw * 100), fromLastRun: true };
  }
  return { pct: Math.round(DEFAULT_STOCK_PCT * 100), fromLastRun: false };
}

/** U+2212 for negative, explicit + otherwise (the formatSignedCurrency register). */
const signedPct = (fraction: number, digits: number): string =>
  `${fraction < 0 ? '−' : '+'}${Math.abs(pctFromFraction(fraction)).toFixed(digits)}%`;

/**
 * W1 — the Stress Test card (D-W1-1..11): five named historical windows
 * replayed against today's portfolio on the Backtest's exact real return
 * basis. Accumulation shock, not drawdown (D-W1-2 — the Backtest tool owns
 * retire-into-a-bad-year, cross-linked below). Gates in-card on the SAME
 * `backtest` disclosure id as the Backtest page (v1.3 covers both surfaces);
 * the page and the card grid are never blocked (DP-7).
 */
export function StressTestCard({ cardId = 'stress-test' }: { cardId?: string }) {
  const location = useLocation();
  const gate = useDisclosureGate('backtest');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const [showDisclosure, setShowDisclosure] = useState(false);

  const { engine, editedCount, scopeExclusions } = useScenarioAssumptions();
  const scope = useCalcScope();

  const stockSeed = useMemo(() => seededStockPct(), []);
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(cardId, {
    stockPct: stockSeed.pct,
  });
  const stockPctPercent = Math.min(100, Math.max(0, Math.round(values.stockPct ?? stockSeed.pct)));
  const bondPctPercent = 100 - stockPctPercent;

  const [mode, setModeState] = useState<StressMode>(readMode);
  const setMode = (m: StressMode) => {
    setModeState(m);
    try {
      sessionStorage.setItem(MODE_KEY, m);
    } catch {
      // view-state only — in-memory state still drives the UI.
    }
  };
  const [windowId, setWindowIdState] = useState<string>(readWindowId);
  const setWindowId = (id: string) => {
    setWindowIdState(id);
    try {
      sessionStorage.setItem(WINDOW_KEY, id);
    } catch {
      // view-state only — in-memory state still drives the UI.
    }
  };
  const win = STRESS_WINDOWS.find((w) => w.id === windowId) ?? STRESS_WINDOWS[0];

  const rows = useMemo(() => datasetReplayRows(stockPctPercent / 100), [stockPctPercent]);
  const firstDataYear = rows[0].year;
  const lastDataYear = rows[rows.length - 1].year;
  const isAvailable = (span: { startYear: number; endYear: number }) =>
    span.startYear >= firstDataYear && span.endYear <= lastDataYear;

  const contribution = mode === 'KEEP' ? engine.annualContribution : 0;
  const result =
    engine.portfolio > 0 && isAvailable(win.span)
      ? replayWindow({
          startBalance: engine.portfolio,
          annualContribution: contribution,
          span: win.span,
          rows,
        })
      : null;

  const nYears = win.span.endYear - win.span.startYear + 1;
  const realRate = realRateOfUnfloored(engine.returnRate, engine.inflation);
  const baselineEnd = result ? flatPathEnd(engine.portfolio, realRate, contribution, nYears) : 0;
  const depth = result ? result.troughBalance / engine.portfolio - 1 : 0;
  const endDelta = result ? result.windowEndBalance / engine.portfolio - 1 : 0;
  // CP-15 is a claim about CONTRIBUTIONS outpacing losses, so it needs both
  // the mode AND a non-zero contribution: a $0/yr KEEP replay whose year-ends
  // never dipped (2008 at a 0% stock mix — the bond leg returned +14.7% real)
  // would otherwise credit contributions that do not exist (review MINOR 9).
  // The mode clause is kept for readability even though `contribution > 0`
  // already implies it (PORTFOLIO pins `contribution` to 0 above) — it states
  // DP-15's rule where it is read.
  const outpaced =
    mode === 'KEEP' &&
    contribution > 0 &&
    result != null &&
    result.troughBalance >= engine.portfolio;

  // ── Gated state (Task 3's v1.3; in-card, never page-blocking — DP-7) ──
  if (gate.state === 'needs-acceptance') {
    return (
      <>
        <CalculatorCard
          cardId={cardId}
          title="Stress Test"
          headline={<span>—</span>}
          meaning={<>Accept the Historical Backtest disclosure to run stress tests.</>}
        >
          <p className="text-sm text-muted-foreground">
            Stress tests replay named historical windows from the same dataset and return basis as the
            Historical Backtest. One disclosure covers both.
          </p>
          <Button
            size="sm"
            aria-label="Read and accept the Backtest disclosure"
            onClick={() => setShowDisclosure(true)}
          >
            Read and accept
          </Button>
        </CalculatorCard>
        {showDisclosure && (
          <DisclosureModal
            document={gate.document}
            onAccept={(v) => acceptDisclaimer('backtest', v)}
            onCancel={() => setShowDisclosure(false)}
          />
        )}
      </>
    );
  }

  // ── Empty state (CP-23; no chips run) ──
  if (engine.portfolio <= 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Stress Test"
        headline={<span>—</span>}
        meaning={
          <EmptyMeaning>
            <InlineLink to="/investments">Add account snapshots</InlineLink> or set a portfolio in the
            scenario bar to stress it.
          </EmptyMeaning>
        }
      />
    );
  }

  const rail = (
    <>
      {isOverridden && <RailReset onClick={reset} />}
      <NumberField
        id="stress-stock-pct"
        label="Stocks (%)"
        value={values.stockPct}
        step="1"
        min={0}
        onChange={(v) => setValue('stockPct', Math.min(100, Math.max(0, Math.round(v ?? 0))))}
        edited={overriddenKeys.has('stockPct')}
      />
      <p className="text-xs text-muted-foreground">
        {stockSeed.fromLastRun
          ? 'from your last Backtest run'
          : "app default 75/25 — the Backtest tool's default mix"}
      </p>
      <div
        role="group"
        aria-label="Stress mode"
        className="inline-flex self-start rounded border overflow-hidden"
      >
        <button
          type="button"
          aria-pressed={mode === 'KEEP'}
          onClick={() => setMode('KEEP')}
          className={cn(SEG_BTN_BASE, mode === 'KEEP' ? SEG_BTN_ACTIVE : '')}
        >
          Keep contributing
        </button>
        <button
          type="button"
          aria-pressed={mode === 'PORTFOLIO'}
          onClick={() => setMode('PORTFOLIO')}
          className={cn(SEG_BTN_BASE, 'border-l', mode === 'PORTFOLIO' ? SEG_BTN_ACTIVE : '')}
        >
          Portfolio only
        </button>
      </div>
    </>
  );

  const unavailableMsg = `The bundled data covers ${firstDataYear}–${lastDataYear} — this window isn't available.`;
  const recoverySentence =
    result == null
      ? null
      : result.recoveredYear == null
        ? `Not back to its starting value by ${lastDataYear}, where the bundled data ends.`
        : mode === 'KEEP'
          ? `Back at its starting value: ${result.recoveredYear} — with your ${formatCurrency(engine.annualContribution)}/yr contributions counted.`
          : `Back at its starting value: ${result.recoveredYear}.`;

  return (
    <CalculatorCard
      cardId={cardId}
      title="Stress Test"
      dirty={isOverridden || editedCount > 0}
      rail={rail}
      headline={<span>{signedPct(depth, 0)} real</span>}
      meaning={
        <>
          deepest year-end of {win.label} against your {formatCurrency(engine.portfolio)} —{' '}
          {stockPctPercent}/{bondPctPercent} mix, today&#39;s dollars
        </>
      }
    >
      <fieldset data-testid="stress-window-picker">
        <legend className="sr-only">Stress window</legend>
        <div className="flex flex-wrap gap-2">
          {STRESS_WINDOWS.map((w) => {
            const ok = isAvailable(w.span);
            const years =
              w.span.startYear === w.span.endYear
                ? String(w.span.startYear)
                : `${w.span.startYear}–${w.span.endYear}`;
            const selected = win.id === w.id;
            return (
              <label
                key={w.id}
                title={ok ? undefined : unavailableMsg}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  selected && 'bg-primary text-primary-foreground border-primary',
                  !ok && 'opacity-50 cursor-not-allowed',
                )}
              >
                <input
                  type="radio"
                  name="stress-window"
                  className="sr-only"
                  value={w.id}
                  checked={selected}
                  disabled={!ok}
                  onChange={() => setWindowId(w.id)}
                />
                {w.label}{' '}
                {/* The year is differentiated by figure style, never by
                    opacity: text-primary-foreground/80 on bg-primary is
                    4.21 (light) / 4.34 (dark), under the 4.5 AA floor for
                    12px text — the solid pair is 5.63 / 5.90 (review MAJOR 5). */}
                <span
                  className={cn(
                    'font-normal tabular-nums',
                    selected ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {years}
                </span>
                {!ok && <span className="sr-only"> — {unavailableMsg}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      {/* CP-20 is contractually the FIRST body line after the picker (the
          meaning-adjacent register line); the window blurb follows it. */}
      <p className="text-sm text-muted-foreground">
        History that happened once — not a forecast, not a probability.
      </p>
      <p className="text-xs text-muted-foreground">{win.blurb}</p>
      {result == null ? (
        <p className="text-sm text-muted-foreground">{unavailableMsg}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ResultRow
              label="Deepest year-end"
              value={
                outpaced
                  ? "Never below its starting value at a year-end — contributions outpaced this window's losses."
                  : `${formatCurrency(result.troughBalance)} in ${result.troughYear} · ${signedPct(depth, 1)} vs start`
              }
            />
            <ResultRow
              label={`End of window (${win.span.endYear})`}
              value={`${formatCurrency(result.windowEndBalance)} · ${signedPct(endDelta, 1)} vs start`}
            />
          </div>
          {!outpaced && recoverySentence && (
            <p className="text-sm" data-testid="stress-recovery">
              {recoverySentence}
            </p>
          )}
          <ResultRow
            label={`Vs your assumed path (${nYears} ${nYears === 1 ? 'year' : 'years'})`}
            value={`${formatCurrency(baselineEnd)} assumed · ${formatCurrency(result.windowEndBalance)} replayed · gap ${formatSignedCurrency(result.windowEndBalance - baselineEnd)}`}
          />
          {result.yearEnds.length > 1 && (
            <InlineChart
              label="Window replay"
              testId="stress-test-chart"
              data={result.yearEnds.map((y) => ({ year: y.year, balance: y.balance }))}
              xKey="year"
              series={[{ dataKey: 'balance', label: 'Portfolio (real $)', hero: true }]}
              markers={[
                { x: result.troughYear, y: result.troughBalance, color: 'hsl(var(--destructive))' },
                ...(result.recoveredYear != null
                  ? [
                      {
                        x: result.recoveredYear,
                        y: result.yearEnds.find((p) => p.year === result.recoveredYear)!.balance,
                        color: 'hsl(var(--blaze))',
                      },
                    ]
                  : []),
              ]}
              yFormatter={formatCurrency}
            />
          )}
        </>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Stock leg: Shiller&#39;s CPI-deflated S&P total return; bond leg: 10-year Treasury total
          return deflated to real. {stockPctPercent}% / {bondPctPercent}% mix, rebalanced annually —
          the same return basis as the Historical Backtest.
        </p>
        <p>All figures in today&#39;s dollars — the window&#39;s inflation is already taken out.</p>
        <p>Measured at year-ends — the data is annual, so the worst moments within a year were deeper.</p>
        <p>
          The assumed path compounds your {formatPercent(engine.returnRate)} return ≈{' '}
          {formatPercent(realRate)} real with the same contribution basis.
        </p>
      </div>
      {scope.isScoped && scopeExclusions && (
        <ScopeExclusionsLine
          personName={scope.personName!}
          noun="stress test"
          jointPortfolio={scopeExclusions.jointPortfolio}
          unattributedContribution={scopeExclusions.unattributedContribution}
          testId="stress-test-scope-exclusions"
        />
      )}
      <div>
        <InlineLink
          to={withViewSearch('/calculators/backtest', location.search)}
          aria-label="Open the Historical Backtest tool"
          className="text-sm"
        >
          Every start year, not just these — open the Backtest tool →
        </InlineLink>
      </div>
    </CalculatorCard>
  );
}
