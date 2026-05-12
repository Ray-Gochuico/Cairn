export interface QuoteResult {
  ticker: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string;
}

// Loaded type-only to keep `yahoo-finance2` itself out of the import graph
// of any file that imports YahooClient.
type YahooFinanceInstance = InstanceType<typeof import('yahoo-finance2').default>;

/**
 * Wraps `yahoo-finance2`. Lazy-loads the underlying package on first method
 * call rather than at module load time — `yahoo-finance2` pulls in
 * `@deno/shim-deno`, which calls `os.platform()` at top level. In the Tauri
 * WebView (and any browser environment), `os` is a stub without `platform`,
 * so an eager import crashes everything else that ships in the bootstrap
 * chunk. Deferring the import scopes that risk to actual Yahoo calls, which
 * already run inside background fire-and-forget paths with try/catch.
 */
export class YahooClient {
  private yfPromise: Promise<YahooFinanceInstance> | null = null;

  private getYf(): Promise<YahooFinanceInstance> {
    if (!this.yfPromise) {
      this.yfPromise = import('yahoo-finance2').then((mod) => new mod.default());
    }
    return this.yfPromise;
  }

  async quote(ticker: string): Promise<QuoteResult> {
    const yf = await this.getYf();
    const q = await yf.quote(ticker);
    return {
      ticker,
      price: q.regularMarketPrice ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      currency: q.currency ?? 'USD',
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns the daily close price for `ticker` on `date` (YYYY-MM-DD).
   *
   * Uses `yahoo-finance2`'s `chart()` API (the supported replacement for
   * the deprecated `historical()`). We pass `period2 = date + 1 day` because
   * the chart endpoint treats `period2` as exclusive — a same-day window
   * comes back empty.
   */
  async historical(ticker: string, date: string): Promise<number> {
    const yf = await this.getYf();
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const result = await yf.chart(ticker, {
      period1: start,
      period2: end,
      interval: '1d',
    });
    const quotes = result.quotes;
    if (!quotes || quotes.length === 0) {
      throw new Error(`No historical price data for ${ticker} on ${date}`);
    }
    const close = quotes[0].close;
    if (close == null) {
      throw new Error(`Historical close price missing for ${ticker} on ${date}`);
    }
    return close;
  }

  async topHoldings(_ticker: string): Promise<Array<{ holdingTicker: string; weight: number }>> {
    return [];
  }
}
