import { useState } from 'react';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberField } from '@/components/calculators/NumberField';
import type { BacktestConfig, WithdrawalStrategyId } from '@/lib/backtest';

// BT-4 — the page validates config against this BEFORE calling backtestPlan, so
// a degenerate config (min>max, NaN, ≤0 portfolio) surfaces as a calm inline
// alert instead of throwing to the route errorElement (which 404-s the page).
// Messages are user-facing (the page shows issues[0].message). `superRefine`
// enforces min ≤ max only when the variable strategy is active. NOTE: zod v4
// `z.number()` already rejects NaN at the base — `.finite()` is deprecated in
// v4 — so an empty input (num('') → 0) is caught by `.min(1)`, and a NaN by
// the base number check; no explicit `.finite()` needed.
export const BacktestParamsSchema = z
  .object({
    initialPortfolio: z.number().min(1, 'Starting portfolio must be at least $1.'),
    annualSpending: z.number().min(0, 'Annual spending cannot be negative.'),
    horizonYears: z
      .number()
      .int('Retirement length must be a whole number of years.')
      .min(1, 'Retirement length must be at least 1 year.')
      .max(60, 'Retirement length cannot exceed 60 years.'),
    goalAmount: z.number().min(0, 'Goal amount cannot be negative.'),
    strategy: z.enum(['bengen', 'constant-dollar', 'variable']),
    stockPct: z.number().min(0).max(1),
    variableRate: z.number().min(0).max(1),
    minWithdrawal: z.number().min(0),
    maxWithdrawal: z.number().min(0),
  })
  .superRefine((c, ctx) => {
    if (c.strategy === 'variable' && c.minWithdrawal > c.maxWithdrawal) {
      ctx.addIssue({
        code: 'custom',
        path: ['minWithdrawal'],
        message: 'Minimum withdrawal cannot exceed the maximum withdrawal.',
      });
    }
  });

interface Props {
  initial: BacktestConfig;
  onChange: (cfg: BacktestConfig) => void;
  onRun: () => void;
  /** BT-8 — true while the engine loop runs; disables Run + shows "Running…". */
  isRunning?: boolean;
}

export function BacktestParamsForm({ initial, onChange, onRun, isRunning = false }: Props) {
  // Local state so the form can re-render on every field change without needing
  // the parent to round-trip the prop (tests drive onChange with vi.fn()). On
  // every change we still call onChange so the parent can sync its own state.
  const [cfg, setCfg] = useState<BacktestConfig>(initial);
  const set = (patch: Partial<BacktestConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    onChange(next);
  };
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField
          id="bt-portfolio"
          label="Starting portfolio ($)"
          value={cfg.initialPortfolio}
          onChange={(v) => set({ initialPortfolio: v ?? 0 })}
          min={0}
        />
        <div>
          <NumberField
            id="bt-spending"
            label="Annual spending ($)"
            value={cfg.annualSpending}
            onChange={(v) => set({ annualSpending: v ?? 0 })}
            min={0}
          />
          <span className="text-xs text-muted-foreground">
            {((cfg.annualSpending / cfg.initialPortfolio) * 100 || 0).toFixed(1)}% of portfolio
          </span>
        </div>
        <div>
          <Label htmlFor="bt-length">Retirement length (years)</Label>
          <Input
            id="bt-length"
            type="number"
            value={cfg.horizonYears}
            onChange={(e) => set({ horizonYears: num(e.target.value) })}
          />
        </div>
        <div>
          <NumberField
            id="bt-goal"
            label="Goal ending amount ($)"
            value={cfg.goalAmount}
            onChange={(v) => set({ goalAmount: v ?? 0 })}
            min={0}
          />
          <span className="text-xs text-muted-foreground">
            $0 = just don&rsquo;t run out; higher = leave a legacy / safety margin
          </span>
        </div>
        <div>
          <Label htmlFor="bt-strategy">Withdrawal strategy</Label>
          {/* Native <select> — avoids Radix jsdom issues in tests; Radix migration owned by a parallel track */}
          <select
            id="bt-strategy"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={cfg.strategy}
            onChange={(e) => set({ strategy: e.target.value as WithdrawalStrategyId })}
          >
            <option value="bengen">4% rule (Bengen)</option>
            <option value="constant-dollar">Constant dollar</option>
            <option value="variable">Variable (% of portfolio)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="bt-stock">Stocks (%)</Label>
          <Input
            id="bt-stock"
            type="number"
            value={Math.round(cfg.stockPct * 100)}
            onChange={(e) => set({ stockPct: num(e.target.value) / 100 })}
          />
          <span className="text-xs text-muted-foreground">Annual rebalance · bonds = remainder</span>
        </div>
      </div>

      {cfg.strategy === 'variable' && (
        <details open className="rounded-md border bg-muted/40 p-3">
          <summary className="text-sm font-semibold cursor-pointer">
            Advanced: withdrawal guardrails{' '}
            <span className="text-xs text-muted-foreground">(Advanced option)</span>
          </summary>
          <p className="text-xs text-muted-foreground my-2">
            Spending flexes with your portfolio but stays within this band — a floor protects your
            lifestyle in down years, a ceiling prevents over-spending in boom years.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="bt-rate">Withdrawal rate (%)</Label>
              <Input
                id="bt-rate"
                type="number"
                value={Math.round(cfg.variableRate * 1000) / 10}
                onChange={(e) => set({ variableRate: num(e.target.value) / 100 })}
              />
            </div>
            <NumberField
              id="bt-min"
              label="Minimum withdrawal ($)"
              value={cfg.minWithdrawal}
              onChange={(v) => set({ minWithdrawal: v ?? 0 })}
              min={0}
            />
            <NumberField
              id="bt-max"
              label="Maximum withdrawal ($)"
              value={cfg.maxWithdrawal}
              onChange={(v) => set({ maxWithdrawal: v ?? 0 })}
              min={0}
            />
          </div>
        </details>
      )}

      <div className="flex items-center gap-3">
        {/* BT-8 — disable + relabel during the loop. aria-label stays stable for
            tests even while visible text reads "Running…" */}
        <Button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          aria-label="Run backtest"
          aria-busy={isRunning}
        >
          {isRunning ? 'Running…' : 'Run backtest'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {cfg.strategy === 'variable' ? 'Variable withdrawal' : 'Fixed real withdrawal'} · real
          (inflation-adjusted) dollars
        </span>
      </div>
    </div>
  );
}
