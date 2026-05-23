import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSettingsStore } from '@/stores/settings-store';
import { getDatabase } from '@/db/db';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { RefreshCadence } from '@/types/enums';

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
  return parsed.toLocaleString();
}

export function RefreshSection() {
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const cadence = settings?.refreshCadence ?? RefreshCadence.EVERY_LAUNCH;

  // "Refresh now" stamps last_refresh_at at initiation and kicks off the
  // same background derivations init.ts runs. The derivations swallow their
  // own errors, so the stamp — not their completion — marks "last
  // refreshed". update() re-loads the store, so the line below refreshes.
  const handleRefreshNow = async () => {
    setRefreshing(true);
    try {
      await update({ lastRefreshAt: new Date().toISOString() });
      runMarketDataRefresh(getDatabase());
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market data</CardTitle>
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
              disabled={settings === null || refreshing}
              onClick={() => void handleRefreshNow()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
            <span className="text-sm text-muted-foreground">
              Last refreshed: {formatLastRefreshed(settings?.lastRefreshAt ?? null)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
