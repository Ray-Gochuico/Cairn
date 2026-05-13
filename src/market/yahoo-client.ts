import { fetch } from '@tauri-apps/plugin-http';

export interface QuoteResult {
  ticker: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string;
}

/**
 * Shape of Yahoo's `/v8/finance/chart/<TICKER>` response, narrowed to
 * the fields we read. Yahoo returns far more — meta blocks, dividends,
 * splits, multiple indicator series. Anything not declared here is
 * either ignored or routed through the optional getters.
 */
interface ChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        currency?: string;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{ close?: Array<number | null> }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';

/**
 * Wraps Yahoo Finance's public chart endpoint.
 *
 * Why a hand-rolled client instead of the `yahoo-finance2` npm package:
 * yahoo-finance2 transitively imports `@deno/shim-deno`, which calls
 * `os.platform()` / `util.promisify(fs.fstat)` at module load. Those
 * Node built-ins don't exist in the Tauri WebView, and even after
 * shimming them the package's internal `fetch` would hit CORS — Yahoo
 * doesn't send `Access-Control-Allow-Origin`, so a direct browser
 * request gets rejected.
 *
 * `@tauri-apps/plugin-http`'s `fetch` routes the request through the
 * Rust shell, which has no CORS policy. Yahoo's chart endpoint returns
 * the JSON we need (current price + daily closes) with no auth and
 * generous rate limits.
 */
export class YahooClient {
  /**
   * Returns the current regular-market price for `ticker`.
   */
  async quote(ticker: string): Promise<QuoteResult> {
    const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const data = await this.fetchChart(url, ticker);
    const result = data.chart.result?.[0];
    if (!result) throw new Error(`No quote data for ${ticker}`);
    const price = result.meta.regularMarketPrice;
    if (price == null) {
      throw new Error(`No regularMarketPrice for ${ticker}`);
    }
    const prevClose = result.meta.chartPreviousClose ?? price;
    const changePct = prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return {
      ticker,
      price,
      changePct,
      currency: result.meta.currency ?? 'USD',
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns the daily close price for `ticker` on `date` (YYYY-MM-DD).
   *
   * Yahoo's chart endpoint uses Unix seconds, with `period2` exclusive.
   * Passing `[start_of_day, start_of_next_day)` returns a single bar
   * for the requested day if markets were open. Weekends/holidays
   * return an empty close array; we throw rather than silently
   * substitute a different day so the snapshot derivation logic can
   * decide how to handle gaps (today: walk back to the previous
   * business day via `lastBusinessDayOfMonth`).
   */
  async historical(ticker: string, date: string): Promise<number> {
    const start = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
    const end = start + 86_400;
    const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    const data = await this.fetchChart(url, ticker);
    const result = data.chart.result?.[0];
    if (!result) {
      throw new Error(`No historical chart data for ${ticker} on ${date}`);
    }
    const closes = result.indicators.quote[0]?.close ?? [];
    const close = closes[0];
    if (close == null) {
      throw new Error(`No close price for ${ticker} on ${date}`);
    }
    return close;
  }

  /**
   * Placeholder — fund top-10 holdings come from Yahoo's `quoteSummary`
   * endpoint with `modules=topHoldings`. Phase 3 will wire it; Phase 2
   * only needs price data, so we keep the method to preserve the
   * existing `YahooClient` interface but return an empty list.
   */
  async topHoldings(_ticker: string): Promise<Array<{ holdingTicker: string; weight: number }>> {
    return [];
  }

  private async fetchChart(url: string, ticker: string): Promise<ChartResponse> {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Yahoo chart fetch failed for ${ticker}: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as ChartResponse;
    if (data.chart.error) {
      throw new Error(`Yahoo error for ${ticker}: ${data.chart.error.description}`);
    }
    return data;
  }
}
