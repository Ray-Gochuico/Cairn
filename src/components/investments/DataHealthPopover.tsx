import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ActivityIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db/db';
import { YahooClient } from '@/market/yahoo-client';
import { TickersRepo } from '@/domain/tickers';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { HoldingsRepo } from '@/domain/holdings';
import { syncStaleFunds, type SyncResult } from '@/market/fund-holdings-sync';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';

/**
 * "Data health" popover — the fund-data debug plumbing that used to live
 * inline in the Investments page header ("Refresh fund data" / "Force
 * refresh sectors" buttons + their status readouts), folded into one
 * self-contained popover anchored beside the FreshnessBadge. Functionality
 * is a 1:1 move — same copy, same testids, same Yahoo/repo wiring. Radix
 * popover (the house precedent — FreshnessBadge) gives Esc + outside-click
 * dismissal for free. The page keeps only the one-shot auto-backfill
 * effect (a page-mount concern, not a debug affordance).
 */

interface SectorRefreshRow {
  ticker: string;
  status: 'ok' | 'empty' | 'error';
  sectorCount?: number;
  error?: string;
}

export function DataHealthPopover() {
  const loadFundHoldings = useFundHoldingsStore((s) => s.load);
  const loadFundSectors = useFundSectorsStore((s) => s.load);

  // "Refresh fund data" button state. Lets the user force a fund-holdings
  // sync without waiting for the next app restart — important when the
  // Per-Company donut is showing fund tickers (VTI, FXAIX) instead of the
  // look-through into underlying companies. The fast-forward `today` trick
  // below bypasses syncStaleFunds's 90-day staleness gate so the button
  // always refetches.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<SyncResult | null>(null);

  const handleRefreshFundData = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const db = getDatabase();
      // Pass a date 100 years in the future as `today` so every cached row
      // reads as older than STALE_DAYS — forces a refresh of every fund the
      // user holds. The constant in fund-holdings-sync stays untouched.
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 100);
      const result = await syncStaleFunds(
        {
          yahoo: new YahooClient(),
          fundHoldings: new FundHoldingsRepo(db),
          fundSectors: new FundSectorsRepo(db),
          tickers: new TickersRepo(db),
          holdings: new HoldingsRepo(db),
        },
        farFuture,
      );
      setRefreshResult(result);
      await loadFundHoldings();
      await loadFundSectors();
    } catch (err) {
      setRefreshResult({
        refreshed: [],
        skipped: [],
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setRefreshing(false);
    }
  };

  // "Force refresh sectors" — a focused debug affordance distinct from
  // "Refresh fund data". This button clears the fund_sectors table for the
  // user's held fund tickers, then calls Yahoo's sectorWeightings endpoint
  // sequentially per ticker so we can surface per-ticker status (ok /
  // empty / error) inline. Two prior fixes shipped that passed tests but
  // the donut stayed grey; this button makes whatever's still going wrong
  // visible to the user without needing to open dev tools.
  const [forceSectorsRunning, setForceSectorsRunning] = useState(false);
  const [sectorRefreshRows, setSectorRefreshRows] = useState<SectorRefreshRow[] | null>(null);

  const handleForceRefreshSectors = async () => {
    setForceSectorsRunning(true);
    setSectorRefreshRows([]);
    const db = getDatabase();
    const yahoo = new YahooClient();
    const sectorsRepo = new FundSectorsRepo(db);
    const tickersRepo = new TickersRepo(db);
    const holdingsRepo = new HoldingsRepo(db);
    const fundClasses = new Set([
      'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
      'INTL_DEVELOPED', 'EMERGING_MARKETS', 'US_BONDS', 'INTL_BONDS', 'TIPS',
      'REAL_ESTATE', 'COMMODITIES',
    ]);
    try {
      const all = await holdingsRepo.listAll();
      const tickers = [...new Set(all.map((h) => h.ticker))];
      const fundTickers: string[] = [];
      for (const t of tickers) {
        const row = await tickersRepo.lookup(t);
        if (row && fundClasses.has(row.assetClass)) fundTickers.push(t);
      }
      // eslint-disable-next-line no-console
      console.log('[ForceRefreshSectors] candidates', { allTickers: tickers, fundTickers });

      const rows: SectorRefreshRow[] = [];
      for (const ticker of fundTickers) {
        try {
          // Fetch first, mutate the table only on success. The old code
          // DELETEd up front so a fetch failure left the row visibly empty,
          // but Yahoo's 429s now wipe the user's data on every retry. Only
          // a non-empty fetch earns the right to replace existing rows;
          // an empty fetch leaves prior rows intact (see the empty branch).
          const { sectors, asOf } = await yahoo.fundSectorWeightings(ticker);
          if (sectors.length === 0) {
            rows.push({ ticker, status: 'empty', sectorCount: 0 });
          } else {
            await db.execute('DELETE FROM fund_sectors WHERE fund_ticker = ?', [ticker]);
            await sectorsRepo.upsertSectors(ticker, sectors, asOf);
            rows.push({ ticker, status: 'ok', sectorCount: sectors.length });
          }
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : String(err);
          // Yahoo's getcrumb auth endpoint serves a generic 429 with no
          // Retry-After; surface a human-readable hint instead of a stack
          // trace so the user understands why the donut stayed grey.
          const message =
            rawMessage.includes('429') || /too many requests/i.test(rawMessage)
              ? 'Yahoo Finance rate-limited the auth endpoint — try again in ~10 minutes'
              : rawMessage;
          rows.push({ ticker, status: 'error', error: message });
        }
        setSectorRefreshRows([...rows]);
      }
      await loadFundSectors();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ForceRefreshSectors] outer failure', err);
      setSectorRefreshRows((prev) => [
        ...(prev ?? []),
        {
          ticker: '(setup)',
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setForceSectorsRunning(false);
    }
  };

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="outline" size="sm" aria-haspopup="dialog">
          <ActivityIcon className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Data health
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-96 max-w-[92vw] rounded-md border bg-popover p-4 text-left text-sm text-popover-foreground shadow-md outline-none space-y-3"
        >
          <div className="text-sm font-medium">Market data health</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshFundData}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing fund data…' : 'Refresh fund data'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceRefreshSectors}
              disabled={forceSectorsRunning}
              title="Clear and re-fetch fund sectors per ticker. Shows per-ticker status."
            >
              {forceSectorsRunning ? 'Refreshing sectors…' : 'Force refresh sectors'}
            </Button>
          </div>
          {refreshResult && (
            <div className="text-xs text-muted-foreground">
              {refreshResult.refreshed.length > 0 && (
                <span className="mr-3">
                  Refreshed: {refreshResult.refreshed.join(', ')}
                </span>
              )}
              {refreshResult.skipped.length > 0 && (
                <span className="mr-3">
                  Skipped: {refreshResult.skipped.join(', ')}
                </span>
              )}
              {refreshResult.errors.length > 0 && (
                <span className="text-destructive-soft-foreground">
                  Errors: {refreshResult.errors.join('; ')}
                </span>
              )}
            </div>
          )}
          {sectorRefreshRows && sectorRefreshRows.length > 0 && (
            <div
              className="rounded-md border bg-muted/30 p-3 text-xs space-y-1"
              data-testid="force-sectors-status"
            >
              <div className="font-medium text-foreground">Force-refresh sectors status</div>
              {sectorRefreshRows.map((row) => (
                <div key={row.ticker} className="flex items-center gap-2 font-mono">
                  <span className="w-16">{row.ticker}</span>
                  {row.status === 'ok' && (
                    <span className="text-success">
                      ok · {row.sectorCount} sectors loaded
                    </span>
                  )}
                  {row.status === 'empty' && (
                    <span className="text-warning">
                      empty · Yahoo returned no sectorWeightings (bond/commodity fund?)
                    </span>
                  )}
                  {row.status === 'error' && (
                    <span className="text-destructive-soft-foreground">error · {row.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
