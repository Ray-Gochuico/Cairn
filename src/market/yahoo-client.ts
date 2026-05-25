import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';

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
 * Convert Yahoo's snake_case sector keys (`financial_services`,
 * `consumer_cyclical`, `realestate`) into the Title Case labels used
 * elsewhere in the app (`Financial Services`, `Consumer Cyclical`,
 * `Real Estate`). The `realestate` key is the only one without an
 * underscore separator, so it gets a one-off override; everything else
 * splits on `_` and capitalises each word.
 */
function snakeToTitleSector(key: string): string {
  if (key === 'realestate') return 'Real Estate';
  return key
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

/**
 * Wraps Yahoo Finance's public chart + quoteSummary endpoints.
 *
 * Why a hand-rolled client instead of the `yahoo-finance2` npm package:
 * yahoo-finance2 transitively imports `@deno/shim-deno`, which calls
 * `os.platform()` / `util.promisify(fs.fstat)` at module load. Those
 * Node built-ins don't exist in the Tauri WebView, and even after
 * shimming them the package's internal `fetch` would hit CORS — Yahoo
 * doesn't send `Access-Control-Allow-Origin`, so a direct browser
 * request gets rejected.
 *
 * Transport split:
 *   - `quote()` / `historical()` use `@tauri-apps/plugin-http`'s `fetch`,
 *     which routes through the Rust shell (no CORS). Yahoo's chart
 *     endpoint requires no auth and has generous rate limits.
 *   - `quoteSummary()` invokes the Rust command `yahoo_quote_summary`
 *     (see `src-tauri/src/yahoo.rs`). Yahoo requires a CSRF "crumb" tied
 *     to session cookies set by `fc.yahoo.com`, and the JS-side
 *     `plugin-http` fetch doesn't reliably surface `Set-Cookie` headers
 *     in the WebView. Rust uses `reqwest`'s cookie jar to keep a single
 *     persistent session and caches the crumb for 24h.
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
   * Calls Yahoo's `/v10/finance/quoteSummary/<TICKER>?modules=<m1>,<m2>,...`
   * endpoint via the Rust `yahoo_quote_summary` Tauri command and returns
   * the raw parsed JSON.
   *
   * All cookie/crumb auth lives in Rust (see `src-tauri/src/yahoo.rs`):
   * the JS side just hands ticker + modules to the command and parses the
   * returned body string. The Rust client maintains a persistent cookie
   * jar and a 24h crumb cache, so this stays cheap across many calls.
   *
   * The return type is `unknown` because each module block has a different
   * shape (topHoldings, fundProfile, price, etc.). Callers that need
   * structured access should use the typed wrappers below (`fundTopHoldings`,
   * `fundProfile`) rather than casting this directly.
   */
  async quoteSummary(ticker: string, modules: string[]): Promise<unknown> {
    const body = await invoke<string>('yahoo_quote_summary', { ticker, modules });
    return JSON.parse(body);
  }

  /**
   * Returns the top holdings for a fund/ETF ticker, sourced from Yahoo's
   * `quoteSummary` endpoint with `modules=topHoldings`.
   *
   * Supersedes the Phase 2 `topHoldings(_ticker)` placeholder (which returned
   * an empty list). Callers in `PriceCache` and snapshot derivation do not use
   * holdings data, so the old method was safe to remove outright.
   */
  async fundTopHoldings(ticker: string): Promise<{ holdings: { symbol: string; weight: number }[]; asOf: string }> {
    const data = await this.quoteSummary(ticker, ['topHoldings']);
    // Using `as any` here because the quoteSummary response is a heterogeneous
    // JSON blob whose shape depends on the requested modules. A full typed
    // interface would be large and fragile against Yahoo API drift; the
    // narrowed typed wrappers (this method and fundProfile) enforce shape at
    // the return boundary instead.
    const result = (data as any).quoteSummary?.result?.[0]?.topHoldings;
    if (!result?.holdings) return { holdings: [], asOf: new Date().toISOString().slice(0, 10) };
    return {
      holdings: result.holdings.map((h: any) => ({
        symbol: h.symbol,
        weight: h.holdingPercent?.raw ?? 0,
      })).filter((h: any) => h.symbol),
      asOf: new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * Returns the sector-weight breakdown for a fund/ETF ticker, sourced from
   * the same `quoteSummary` endpoint with `modules=topHoldings`. Yahoo
   * returns 11 GICS sectors in `topHoldings.sectorWeightings`, each as a
   * single-key object like `{financial_services: {raw: 0.14}}`. We
   * normalise the key to Title Case so labels match the assetProfile-driven
   * sectors for individual equities (e.g. "Financial Services").
   *
   * For non-equity funds (pure bond ETFs, commodity ETFs) Yahoo emits the
   * array with all-zero weights, or omits it entirely. We drop zero-weight
   * rows so the downstream sector donut doesn't fan out into eleven empty
   * wedges, and return `sectors: []` so callers can fall back to the
   * asset-class pseudo-sector ("Fixed Income", "Commodities", etc.).
   */
  async fundSectorWeightings(ticker: string): Promise<{ sectors: { sector: string; weight: number }[]; asOf: string }> {
    const data = await this.quoteSummary(ticker, ['topHoldings']);
    // Same `as any` rationale as fundTopHoldings / fundProfile — quoteSummary
    // returns an open-ended JSON blob; the typed boundary is this return type.
    const result = (data as any).quoteSummary?.result?.[0]?.topHoldings;
    const rawSectors = result?.sectorWeightings;
    const asOf = new Date().toISOString().slice(0, 10);
    if (!Array.isArray(rawSectors)) return { sectors: [], asOf };
    const sectors: { sector: string; weight: number }[] = [];
    for (const entry of rawSectors) {
      if (!entry || typeof entry !== 'object') continue;
      const keys = Object.keys(entry);
      if (keys.length === 0) continue;
      const key = keys[0];
      const weight = (entry as any)[key]?.raw;
      if (typeof weight !== 'number' || weight <= 0) continue;
      sectors.push({ sector: snakeToTitleSector(key), weight });
    }
    return { sectors, asOf };
  }

  /**
   * Returns the Morningstar category and instrument type for `ticker`,
   * sourced from Yahoo's `quoteSummary` endpoint with `modules=fundProfile,price`.
   */
  async fundProfile(ticker: string): Promise<{ category: string | null; quoteType: string | null }> {
    const data = await this.quoteSummary(ticker, ['fundProfile', 'price']);
    // Same `as any` rationale as fundTopHoldings — quoteSummary returns an
    // open-ended JSON blob; the typed boundary is this method's return type.
    const profile = (data as any).quoteSummary?.result?.[0]?.fundProfile;
    const price = (data as any).quoteSummary?.result?.[0]?.price;
    return { category: profile?.categoryName ?? null, quoteType: price?.quoteType ?? null };
  }

  /**
   * Returns the GICS-style sector and industry for `ticker`, sourced from
   * Yahoo's `quoteSummary` endpoint with `modules=assetProfile`.
   *
   * For individual equities Yahoo populates `assetProfile.sector` (e.g.
   * "Technology") and `assetProfile.industry` (e.g. "Software—Infrastructure").
   * Funds/ETFs typically lack this block — they expose category data via
   * `fundProfile` instead — so we return nulls rather than throwing when
   * either field is absent. Callers (see `enrichTickerIfMissing` in Task 5)
   * persist whatever is returned, and the sector-classification helpers
   * decide how to bucket nulls for the industry donut.
   */
  async assetProfile(ticker: string): Promise<{ sector: string | null; industry: string | null }> {
    const data = await this.quoteSummary(ticker, ['assetProfile']);
    // Same `as any` rationale as fundTopHoldings / fundProfile — quoteSummary
    // returns an open-ended JSON blob; the typed boundary is this return type.
    const profile = (data as any).quoteSummary?.result?.[0]?.assetProfile;
    return { sector: profile?.sector ?? null, industry: profile?.industry ?? null };
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
