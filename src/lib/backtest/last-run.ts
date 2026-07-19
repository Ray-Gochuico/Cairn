import { z } from 'zod';

const KEY = 'backtest:last-run:v1';

/**
 * D3: the last run's verdict is DERIVED data (recomputable in <1s), so it
 * lives in localStorage as a fail-soft cache — not in app_settings (user
 * config churn) and not in a new table (migration for a cache). Versioned
 * key; any parse failure reads as "no last run". Config drift is handled by
 * honesty in copy ("last run {date}"), not staleness math.
 */
export const BacktestLastRunSchema = z.object({
  v: z.literal(1),
  runAt: z.string(), // ISO datetime
  goalMetCount: z.number().int().nonnegative(),
  startYearsCount: z.number().int().positive(),
  survivedCount: z.number().int().nonnegative(),
  /** The exact config that produced the verdict (display/debug only). */
  config: z.record(z.string(), z.unknown()),
});
export type BacktestLastRun = z.infer<typeof BacktestLastRunSchema>;

export function readLastBacktestRun(): BacktestLastRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const parsed = BacktestLastRunSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLastBacktestRun(run: BacktestLastRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // Storage unavailable — the card just keeps its first-run state.
  }
}
