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

  async topHoldings(_ticker: string): Promise<Array<{ holdingTicker: string; weight: number }>> {
    return [];
  }
}
