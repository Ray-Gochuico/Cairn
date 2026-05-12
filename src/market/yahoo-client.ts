import YahooFinance from 'yahoo-finance2';

export interface QuoteResult {
  ticker: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string;
}

export class YahooClient {
  private yf = new YahooFinance();

  async quote(ticker: string): Promise<QuoteResult> {
    const q = await this.yf.quote(ticker);
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
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const result = await this.yf.chart(ticker, {
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
