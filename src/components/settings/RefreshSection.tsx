import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSettingsStore } from '@/stores/settings-store';
import { getDatabase } from '@/db/db';
import {
  runMarketDataRefresh,
  type MarketDataRefreshResult,
} from '@/market/run-market-data-refresh';
import { RefreshCadence } from '@/types/enums';
import { isExploreMode } from '@/lib/explore-mode';

const selectClass =
  'flex h-9 w-48 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const CADENCE_LABELS: Record<RefreshCadence, string> = {
  [RefreshCadence.EVERY_LAUNCH]: 'Every launch',
  [RefreshCadence.DAILY]: 'Once a day',
  [RefreshCadence.WEEKLY]: 'Once a week',
  [RefreshCadence.MANUAL]: 'Manual only',
};

function formatLastRefreshed(iso: string | null): string {
  if (iso === null) return 'never';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'never';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * W19: the tickers that couldn't be priced, parsed from the snapshot
 * branch's per-ticker error strings ("<accountId>/<ticker>: <message>").
 */
function unpriceableTickers(snapshot: MarketDataRefreshResult['snapshot']): string[] {
  if (snapshot.status !== 'ok') return [];
  const tickers = snapshot.result.errors
    .map((e) => e.split(':')[0]?.split('/')[1])
    .filter((t): t is string => Boolean(t));
  return [...new Set(tickers)];
}

/**
 * W19: honest partial-refresh copy. deriveTodaysSnapshot deliberately holds
 * back an account's WHOLE snapshot when any of its holdings fails to price
 * (never an under-counted AUTO_DERIVED row) — say so, naming the tickers.
 * Exported for the freshness-badge popover so both refresh surfaces speak
 * the same copy (W19 review: one parse, not two).
 */
export function partialWarning(result: MarketDataRefreshResult): string | null {
  if (result.snapshot.status !== 'ok') return null;
  const { partial } = result.snapshot.result;
  if (partial.length === 0) return null;
  const tickers = unpriceableTickers(result.snapshot);
  const who = tickers.length > 0 ? tickers.join(', ') : 'some holdings';
  return partial.length === 1
    ? `Couldn't price ${who} — this account's total was left unchanged.`
    : `Couldn't price ${who} — ${partial.length} accounts' totals were left unchanged.`;
}

export function RefreshSection() {
  // W4 (D-S7): explore is offline — a live market refresh would silently
  // repaint the pinned sample narrative. The cadence select stays writable:
  // it writes SAMPLE settings, wiped on exit.
  const exploring = isExploreMode();
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);
  const [refreshing, setRefreshing] = useState(false);
  // Round-3 E5: a failed refresh surfaces here instead of silently reading
  // as fresh via a premature stamp.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // W19: a COMPLETED refresh that couldn't price some tickers reports the
  // held-back accounts here (warning, not failure — the stamp still lands).
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const cadence = settings?.refreshCadence ?? RefreshCadence.DAILY;

  // Round-3 E5 + W19: the stamp means "prices were actually refreshed", so
  // GENUINELY await the refresh (the aggregate resolves only after all three
  // branches settle) and stamp after. Policy pinned by tests:
  //   - snapshot branch ok, some accounts partial → stamp AND name the
  //     unpriceable tickers (a completed attempt, honestly reported);
  //   - snapshot branch failed outright → no stamp, failure copy (nothing
  //     about account values is fresher than before);
  //   - the await itself throwing (defensive; the aggregate never rejects)
  //     → no stamp, failure copy.
  // update() re-loads the store, so the "Last refreshed" line refreshes.
  const handleRefreshNow = async () => {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshWarning(null);
    try {
      const result = await runMarketDataRefresh(getDatabase());
      if (result.snapshot.status === 'error') {
        setRefreshError(result.snapshot.error);
        return;
      }
      await update({ lastRefreshAt: new Date().toISOString() });
      setRefreshWarning(partialWarning(result));
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold leading-none tracking-tight">Market data</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          How often to refresh investment prices and fund holdings from
          Yahoo.
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="refresh-cadence">Refresh frequency</Label>
            <select
              id="refresh-cadence"
              aria-label="Refresh frequency"
              className={selectClass}
              value={cadence}
              disabled={settings === null}
              onChange={(e) =>
                void update({ refreshCadence: e.target.value as RefreshCadence })
              }
            >
              {(Object.keys(CADENCE_LABELS) as RefreshCadence[]).map((value) => (
                <option key={value} value={value}>
                  {CADENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={settings === null || refreshing || exploring}
              onClick={() => void handleRefreshNow()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
            <span className="text-sm text-muted-foreground">
              Last refreshed: {formatLastRefreshed(settings?.lastRefreshAt ?? null)}
            </span>
          </div>
          {exploring && (
            <p className="text-sm text-muted-foreground" data-testid="sample-mode-refresh-note">
              Sample data doesn&apos;t refresh from the market.
            </p>
          )}
          {refreshError && (
            <p role="alert" className="text-sm text-destructive-soft-foreground">
              Refresh failed: {refreshError}. The last-refreshed time was not updated.
            </p>
          )}
          {refreshWarning && (
            <p
              role="status"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
            >
              {refreshWarning}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
