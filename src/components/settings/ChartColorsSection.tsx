import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorSwatchPicker } from '@/components/forms/ColorSwatchPicker';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { colorForAccount, colorForTicker } from '@/lib/chart-colors';

/**
 * The Settings page "Chart colors" section. Two subsections — Accounts
 * and Tickers — each a list of rows with a swatch button that opens a
 * ColorSwatchPicker in a Radix Popover (Wave-4 a11y: the old hand-rolled
 * overlay+panel had no role, no aria-expanded/haspopup, no Esc-close and
 * no focus restore — Radix supplies the whole contract). Picks write
 * straight through the store actions; there is no React Hook Form here.
 */
export function ChartColorsSection() {
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const updateAccount = useAccountsStore((s) => s.update);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const tickers = useTickersStore((s) => s.tickers);
  const loadTickers = useTickersStore((s) => s.load);
  const setTickerColor = useTickersStore((s) => s.setAccentColor);

  // `account:<id>` or `ticker:<symbol>` — whichever popover is open, or null.
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    void loadAccounts();
    void loadHoldings();
    void loadTickers();
  }, [loadAccounts, loadHoldings, loadTickers]);

  // The distinct tickers across all holdings — the set the per-company
  // donut shows — joined to their metadata for the name and color.
  const tickerRows = useMemo(() => {
    const symbols = [...new Set(holdings.map((h) => h.ticker))].sort();
    return symbols.map((symbol) => {
      const meta = tickers.find((t) => t.ticker === symbol);
      return {
        symbol,
        name: meta?.name ?? null,
        accentColor: meta?.accentColor ?? null,
      };
    });
  }, [holdings, tickers]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chart colors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="text-sm font-medium">Accounts</div>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="space-y-1">
              {accounts.map((account) => {
                const id = account.id!;
                const key = `account:${id}`;
                const resolved = colorForAccount(id, account.accentColor);
                return (
                  <li key={id} className="relative flex items-center gap-3 py-1">
                    <Popover
                      open={openKey === key}
                      onOpenChange={(o) => setOpenKey(o ? key : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Edit color for ${account.name}`}
                          style={{ background: resolved }}
                          className="h-6 w-6 rounded-md border shrink-0"
                        />
                      </PopoverTrigger>
                      {/* Radix supplies role="dialog", aria-expanded/haspopup on
                          the trigger, Esc-close, click-outside, and focus
                          restore — the whole Wave-4 popover contract. */}
                      <PopoverContent align="start" side="bottom" className="w-auto p-2">
                        <ColorSwatchPicker
                          value={account.accentColor}
                          onChange={(next) => {
                            setOpenKey(null);
                            void updateAccount(id, { accentColor: next });
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <span className="text-sm flex-1 truncate">{account.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Tickers</div>
          {tickerRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holdings yet.</p>
          ) : (
            <ul className="space-y-1">
              {tickerRows.map((row) => {
                const key = `ticker:${row.symbol}`;
                const resolved = colorForTicker(row.symbol, row.accentColor);
                return (
                  <li key={row.symbol} className="relative flex items-center gap-3 py-1">
                    <Popover
                      open={openKey === key}
                      onOpenChange={(o) => setOpenKey(o ? key : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Edit color for ${row.symbol}`}
                          style={{ background: resolved }}
                          className="h-6 w-6 rounded-md border shrink-0"
                        />
                      </PopoverTrigger>
                      <PopoverContent align="start" side="bottom" className="w-auto p-2">
                        <ColorSwatchPicker
                          value={row.accentColor}
                          onChange={(next) => {
                            setOpenKey(null);
                            void setTickerColor(row.symbol, next);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <span className="text-sm font-medium">{row.symbol}</span>
                    {row.name && (
                      <span className="text-sm text-muted-foreground flex-1 truncate">
                        {row.name}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
