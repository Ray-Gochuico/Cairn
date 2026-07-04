import { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { RefreshCadence } from '@/types/enums';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { getDatabase } from '@/db/db';

interface FreshnessBadgeProps {
  /**
   * Optional override; defaults to reading the value from
   * `useSettingsStore().settings.lastRefreshAt`. Pass an explicit value
   * when a surface knows it shows older derived data (e.g. a snapshot
   * dated independently of the last price-refresh).
   */
  lastRefreshAt?: string | null;
  /**
   * Optional override; defaults to reading the value from
   * `useSettingsStore().settings.refreshCadence`. Cadence drives whether
   * the badge nags the user — "MANUAL" disables the warning entirely
   * (the user explicitly opted out of automatic refreshes).
   */
  cadence?: RefreshCadence;
  /**
   * Visual size — 'sm' is the inline pill that sits next to a value,
   * 'md' is sized for card headers (slightly larger text + icon).
   */
  size?: 'sm' | 'md';
  /** Optional className for layout customization (margin / alignment). */
  className?: string;
}

/**
 * Multiplier on top of the configured cadence threshold before we consider
 * the data "stale enough to nag". A daily-cadence user whose last refresh
 * was 25 hours ago has merely missed today's run — no need to warn. We wait
 * for 1.5× (36 hours daily / 10.5 days weekly) before flipping into the
 * warning state.
 */
const STALENESS_MULTIPLIER = 1.5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days threshold per cadence after which `lastRefreshAt` is considered
 * stale-enough to warn the user. Returns `null` for cadences that opt out
 * of staleness warnings (MANUAL — the user explicitly opted out).
 */
function stalenessDays(cadence: RefreshCadence): number | null {
  switch (cadence) {
    case RefreshCadence.EVERY_LAUNCH:
    case RefreshCadence.DAILY:
      return 1 * STALENESS_MULTIPLIER;
    case RefreshCadence.WEEKLY:
      return 7 * STALENESS_MULTIPLIER;
    case RefreshCadence.MANUAL:
    default:
      return null;
  }
}

function isStale(
  lastRefreshAt: string,
  cadence: RefreshCadence,
  now: Date,
): boolean {
  const days = stalenessDays(cadence);
  if (days === null) return false;
  const elapsedMs = now.getTime() - new Date(lastRefreshAt).getTime();
  return elapsedMs >= days * MS_PER_DAY;
}

const CADENCE_LABEL: Record<RefreshCadence, string> = {
  [RefreshCadence.EVERY_LAUNCH]: 'every launch',
  [RefreshCadence.DAILY]: 'daily',
  [RefreshCadence.WEEKLY]: 'weekly',
  [RefreshCadence.MANUAL]: 'manual',
};

/**
 * Inline freshness pill — surfaces how long ago market data was last
 * refreshed so the user is never confused by stale prices. Defaults to
 * reading `lastRefreshAt` and `refreshCadence` from the settings store;
 * both can be overridden via props (useful for tests + per-surface
 * timestamps once we add more granular refresh tracking).
 *
 * Behavior:
 *   - Renders nothing if `lastRefreshAt` is null (first launch — no refresh
 *     has ever run, nothing to be honest about yet).
 *   - Shows "Updated <X> ago" using `formatDistanceToNow`.
 *   - Hover/focus reveals a popover with the exact timestamp + cadence
 *     context + a "Refresh now" action.
 *   - When `lastRefreshAt` is older than the cadence threshold × 1.5,
 *     paints in warning colors with an `AlertCircle` icon. Cadence
 *     "MANUAL" disables the warning entirely.
 *
 * A11y:
 *   - aria-label: "Market prices last updated <exact ISO timestamp>"
 *   - keyboard-accessible via Radix Popover focus management.
 */
export function FreshnessBadge({
  lastRefreshAt: lastRefreshAtProp,
  cadence: cadenceProp,
  size = 'sm',
  className,
}: FreshnessBadgeProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Resolve the inputs. Explicit props take precedence so tests + future
  // per-surface timestamps don't depend on the global store.
  const lastRefreshAt = lastRefreshAtProp !== undefined ? lastRefreshAtProp : settings?.lastRefreshAt ?? null;
  const cadence = cadenceProp ?? settings?.refreshCadence ?? RefreshCadence.DAILY;

  // Debounce hover-out so the user can travel the cursor from trigger
  // into the popover without it closing prematurely. Same 120 ms used by
  // TermTooltip — matches existing primitive feel.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => cancelClose(), []);

  // First-launch user — nothing to surface yet.
  if (lastRefreshAt === null) return null;

  const refreshDate = new Date(lastRefreshAt);
  // Defensive: if the stored timestamp is garbage, render nothing rather
  // than blow up the surface.
  if (Number.isNaN(refreshDate.getTime())) return null;

  const now = new Date();
  const stale = isStale(lastRefreshAt, cadence, now);
  const distance = formatDistanceToNow(refreshDate, { addSuffix: false });
  const exactTimestamp = refreshDate.toLocaleString();
  const isoTimestamp = refreshDate.toISOString();
  const cadenceLabel = CADENCE_LABEL[cadence];

  const handleRefreshNow = async () => {
    setRefreshing(true);
    try {
      await updateSettings({ lastRefreshAt: new Date().toISOString() });
      runMarketDataRefresh(getDatabase());
      setOpen(false);
    } finally {
      setRefreshing(false);
    }
  };

  const sizeClasses =
    size === 'md'
      ? 'text-sm px-2.5 py-1 gap-1.5'
      : 'text-xs px-2 py-0.5 gap-1';
  const iconSize = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Market prices last updated ${exactTimestamp}`}
          data-testid="freshness-badge"
          data-stale={stale || undefined}
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
          onClick={(e) => {
            // Own click semantics so the user-event v14 hover-then-click
            // race doesn't immediately close the popover. Matches the
            // pattern in TermTooltip.
            e.preventDefault();
            cancelClose();
            setOpen(true);
          }}
          className={cn(
            'inline-flex items-center rounded-full border whitespace-nowrap tabular-nums',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'transition-colors',
            sizeClasses,
            stale
              ? 'border-warning/40 bg-warning-soft text-warning-foreground hover:bg-warning/15'
              : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
            className,
          )}
        >
          {stale && (
            <AlertCircleIcon className={cn(iconSize, 'shrink-0')} aria-hidden />
          )}
          <span>Updated {distance} ago</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          // Wave-4 a11y: no role override — Radix's default role="dialog"
          // is the truthful role; role="tooltip" forbids the interactive
          // Refresh-now / Settings controls this popover contains.
          sideOffset={6}
          collisionPadding={8}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          // Keep focus on the trigger so sighted-keyboard users see the
          // ring on the badge, but allow Tab into the popover (Refresh now
          // / Settings link are tabbable).
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-72 rounded-md border bg-popover px-3 py-2.5 text-left text-sm text-popover-foreground shadow-md outline-none"
        >
          <div className="font-semibold mb-1 flex items-center gap-1.5">
            {stale && (
              <AlertCircleIcon
                className="h-4 w-4 text-warning-foreground shrink-0"
                aria-hidden
              />
            )}
            <span>Market data freshness</span>
          </div>
          <div className="text-muted-foreground">
            Last refreshed {exactTimestamp}.
          </div>
          <div className="text-muted-foreground mt-1">
            Your refresh cadence is set to{' '}
            <span className="font-medium text-foreground">{cadenceLabel}</span>.
          </div>
          {stale && (
            <div className="text-warning-foreground mt-2 text-xs">
              Data may be out of date — consider refreshing.
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefreshNow()}
              className={cn(
                'text-primary underline hover:no-underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
                refreshing && 'opacity-50 cursor-wait',
              )}
              data-testid="freshness-refresh-now"
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
            <a
              href="#/settings/refresh"
              className="text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Change cadence
            </a>
          </div>
          <time
            dateTime={isoTimestamp}
            className="sr-only"
          >
            {isoTimestamp}
          </time>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export default FreshnessBadge;
