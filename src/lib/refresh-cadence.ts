import { RefreshCadence } from '@/types/enums';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether a market-data refresh is due on launch, given the configured
 * cadence and the ISO timestamp of the last refresh.
 *
 *   - EVERY_LAUNCH → always due.
 *   - MANUAL       → never due (only the "Refresh now" button refreshes).
 *   - DAILY        → due if `lastRefreshAt` is null, or ≥ 1 day has elapsed.
 *   - WEEKLY       → due if `lastRefreshAt` is null, or ≥ 7 days have elapsed.
 *
 * `init.ts` calls this on every launch to decide whether to run
 * `runMarketDataRefresh`.
 */
export function isRefreshDue(
  cadence: RefreshCadence,
  lastRefreshAt: string | null,
  now: Date,
): boolean {
  if (cadence === RefreshCadence.EVERY_LAUNCH) return true;
  if (cadence === RefreshCadence.MANUAL) return false;
  if (lastRefreshAt === null) return true;

  const elapsedMs = now.getTime() - new Date(lastRefreshAt).getTime();
  const thresholdDays = cadence === RefreshCadence.WEEKLY ? 7 : 1;
  return elapsedMs >= thresholdDays * MS_PER_DAY;
}
