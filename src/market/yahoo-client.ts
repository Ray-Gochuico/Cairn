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
 * Reads Set-Cookie headers from a fetch Response in a way that works
 * across both the modern fetch spec (`Headers.getSetCookie()` returns
 * an array of individual values) and older runtimes that join all
 * Set-Cookie values into a single comma-delimited string via `.get()`.
 *
 * Yahoo's specific session cookies (A1, A3, B, A1S, GUC) are simple
 * `name=value` pairs with Expires/Path/Domain attributes that we strip
 * with `.split(';')[0]`, so even the imperfect comma-split fallback is
 * adequate — none of these cookie values contain unescaped commas.
 */
function readSetCookieHeaders(headers: Headers): string[] {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  const joined = headers.get('set-cookie');
  if (!joined) return [];
  // Split on `, <cookie-name>=` lookahead. Date attributes inside cookies
  // contain commas (e.g. "Expires=Wed, 21 Oct 2026 ..."), but those are
  // followed by a space + day-name, not a `name=` pattern, so the
  // lookahead skips them correctly.
  return joined.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
}

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
   * Cached session credentials for the `quoteSummary` endpoint, which
   * since 2023 requires a CSRF "crumb" tied to a set of session cookies.
   * The chart endpoint used by `quote()` / `historical()` does NOT need
   * these — keep `quote()` and `historical()` unauthenticated for speed.
   *
   * The pair is refreshed lazily on first `quoteSummary` call and reused
   * for 24h, or invalidated on a mid-session 401/403 so we re-auth once
   * and retry.
   */
  private _cookieHeader: string | null = null;
  private _crumb: string | null = null;
  private _authFetchedAt: number = 0;
  private static readonly AUTH_TTL_MS = 24 * 60 * 60 * 1000;

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
   * endpoint and returns the raw parsed JSON.
   *
   * The return type is `unknown` because each module block has a different
   * shape (topHoldings, fundProfile, price, etc.). Callers that need
   * structured access should use the typed wrappers below (`fundTopHoldings`,
   * `fundProfile`) rather than casting this directly.
   */
  async quoteSummary(ticker: string, modules: string[]): Promise<unknown> {
    const { cookie, crumb } = await this.ensureAuth();
    const buildUrl = (c: string) =>
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules.join(',')}&crumb=${encodeURIComponent(c)}`;

    const res = await fetch(buildUrl(crumb), {
      method: 'GET',
      headers: { Cookie: cookie },
    });
    if (res.status === 401 || res.status === 403) {
      // Session expired mid-life. Invalidate the cache, re-auth once,
      // and retry. A second failure surfaces as a normal error.
      this._cookieHeader = null;
      this._crumb = null;
      this._authFetchedAt = 0;
      const { cookie: cookie2, crumb: crumb2 } = await this.ensureAuth();
      const retryRes = await fetch(buildUrl(crumb2), {
        method: 'GET',
        headers: { Cookie: cookie2 },
      });
      if (!retryRes.ok) {
        throw new Error(`Yahoo quoteSummary ${ticker} failed: ${retryRes.status}`);
      }
      return retryRes.json();
    }
    if (!res.ok) throw new Error(`Yahoo quoteSummary ${ticker} failed: ${res.status}`);
    return res.json();
  }

  /**
   * Lazily fetches (and caches) the cookie + crumb pair required to call
   * Yahoo's `quoteSummary` endpoint. The flow:
   *
   *   1. GET https://fc.yahoo.com — returns 404 in body, but the response
   *      headers carry the session cookies (A1, A3, B, GUC, etc.) that
   *      the crumb endpoint requires.
   *   2. GET https://query1.finance.yahoo.com/v1/test/getcrumb with the
   *      cookies attached. Body is the raw crumb string (~11 chars).
   *   3. Subsequent quoteSummary calls append `&crumb=<crumb>` and send
   *      the cookies as a `Cookie:` header.
   *
   * Both values are stable for ~24h per session, so we cache them on the
   * instance and refresh on TTL expiry or on a mid-session 401/403.
   *
   * NB: `fc.yahoo.com` must be whitelisted in
   * `src-tauri/capabilities/default.json` under the `http:default` allow
   * list, alongside `query1`/`query2`; without it the Tauri shell blocks
   * the request with an ACL error before it hits the network.
   */
  private async ensureAuth(): Promise<{ cookie: string; crumb: string }> {
    const fresh =
      this._cookieHeader &&
      this._crumb &&
      Date.now() - this._authFetchedAt < YahooClient.AUTH_TTL_MS;
    if (fresh) {
      return { cookie: this._cookieHeader!, crumb: this._crumb! };
    }

    // Step 1: Issue session cookies. fc.yahoo.com returns a 404 body but
    // sets cookies on the response — we explicitly don't check `.ok`.
    const cookieRes = await fetch('https://fc.yahoo.com', { method: 'GET' });
    const rawCookies = readSetCookieHeaders(cookieRes.headers);
    if (rawCookies.length === 0) {
      throw new Error('Yahoo cookie endpoint returned no Set-Cookie headers');
    }
    // Reduce each `name=value; Path=/; Expires=...; Domain=...; Secure`
    // to just `name=value`, then join into a single Cookie header value.
    const cookieHeader = rawCookies
      .map((c) => c.split(';')[0].trim())
      .filter((c) => c.length > 0)
      .join('; ');
    if (cookieHeader.length === 0) {
      throw new Error('Yahoo cookie endpoint returned empty cookie values');
    }

    // Step 2: Fetch the crumb tied to those cookies.
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      method: 'GET',
      headers: { Cookie: cookieHeader },
    });
    if (!crumbRes.ok) {
      throw new Error(`Yahoo getcrumb failed: ${crumbRes.status}`);
    }
    const crumb = (await crumbRes.text()).trim();
    if (!crumb) throw new Error('Yahoo getcrumb returned empty body');

    this._cookieHeader = cookieHeader;
    this._crumb = crumb;
    this._authFetchedAt = Date.now();
    return { cookie: cookieHeader, crumb };
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
