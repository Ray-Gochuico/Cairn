import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { YahooClient } from '@/market/yahoo-client';
import type { TickersRepo } from '@/domain/tickers';
import type { Ticker } from '@/types/schema';
import { enrichTickerIfMissing } from '@/market/ticker-enrichment';

function makeYahooMock(
  overrides: Partial<{ fundProfile: ReturnType<typeof vi.fn> }> = {},
): YahooClient {
  return {
    fundProfile: vi.fn().mockResolvedValue({ category: null, quoteType: null }),
    ...overrides,
  } as unknown as YahooClient;
}

function makeTickersMock(
  overrides: Partial<{ lookup: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }> = {},
): TickersRepo {
  return {
    lookup: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TickersRepo;
}

const existingTicker: Ticker = {
  ticker: 'VTI',
  name: 'Vanguard Total Stock Market ETF',
  assetClass: 'US_TOTAL_MARKET',
  leverageFactor: 1,
  direction: 'LONG',
  userAdded: false,
  accentColor: null,
};

describe('enrichTickerIfMissing', () => {
  it('returns immediately when ticker already exists', async () => {
    const yahoo = makeYahooMock();
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue(existingTicker),
    });

    await enrichTickerIfMissing('VTI', { yahoo, tickers });

    expect(tickers.lookup).toHaveBeenCalledWith('VTI');
    expect(yahoo.fundProfile).not.toHaveBeenCalled();
    expect(tickers.upsert).not.toHaveBeenCalled();
  });

  it('fetches Yahoo fundProfile and upserts when ticker is missing', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({ category: 'Large Blend', quoteType: 'ETF' }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('VTI', { yahoo, tickers });

    expect(yahoo.fundProfile).toHaveBeenCalledWith('VTI');
    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'VTI',
        assetClass: 'US_LARGE_CAP',
        leverageFactor: 1,
        direction: 'LONG',
        userAdded: false,
      }),
    );
  });

  it('maps Yahoo categoryName to AssetClass', async () => {
    const cases: Array<[string, string]> = [
      ['Large Blend', 'US_LARGE_CAP'],
      ['Large Growth', 'US_LARGE_CAP'],
      ['Large Value', 'US_LARGE_CAP'],
      ['Mid-Cap Blend', 'US_MID_CAP'],
      ['Small-Cap Value', 'US_SMALL_CAP'],
      ['Total Stock Market', 'US_TOTAL_MARKET'],
      ['Foreign Large Blend', 'INTL_DEVELOPED'],
      ['International Small', 'INTL_DEVELOPED'],
      ['Diversified Developed Markets', 'INTL_DEVELOPED'],
      ['Diversified Emerging Markets', 'EMERGING_MARKETS'],
      ['Intermediate-Term Bond', 'US_BONDS'],
      ['Inflation-Protected Bond (TIPS)', 'TIPS'],
      ['Real Estate', 'REAL_ESTATE'],
      ['Commodities Focused', 'COMMODITIES'],
    ];

    for (const [category, expectedClass] of cases) {
      const yahoo = makeYahooMock({
        fundProfile: vi.fn().mockResolvedValue({ category, quoteType: 'ETF' }),
      });
      const tickers = makeTickersMock();

      await enrichTickerIfMissing('TEST', { yahoo, tickers });

      expect(tickers.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ assetClass: expectedClass }),
      );
      vi.clearAllMocks();
    }
  });

  it('falls back to OTHER for unrecognized Yahoo category', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({
        category: 'Some Weird Specialty Fund',
        quoteType: 'ETF',
      }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('WEIRD', { yahoo, tickers });

    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ assetClass: 'OTHER' }),
    );
  });

  it('uses leverage-detection on ticker symbol when adding leveraged ETFs', async () => {
    // TQQQ → 3X leverage from symbol; category maps to OTHER (not a standard category)
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({
        category: 'Triple Leveraged Energy',
        quoteType: 'ETF',
      }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('NEWXX', { yahoo, tickers });

    // 'Triple Leveraged Energy' → TRIPLE_NAME regex picks up leverageFactor=3
    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'NEWXX',
        leverageFactor: 3,
        assetClass: 'OTHER', // category doesn't map to any known class
      }),
    );
  });

  it('swallows Yahoo errors silently (best-effort)', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockRejectedValue(new Error('Yahoo network failure')),
    });
    const tickers = makeTickersMock();

    // Should not throw
    await expect(enrichTickerIfMissing('BAD', { yahoo, tickers })).resolves.toBeUndefined();

    expect(tickers.upsert).not.toHaveBeenCalled();
  });

  it('handles equity quoteType as SINGLE_STOCK', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({ category: null, quoteType: 'EQUITY' }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('AAPL', { yahoo, tickers });

    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ assetClass: 'SINGLE_STOCK' }),
    );
  });

  it('handles crypto quoteType as CRYPTO', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({ category: null, quoteType: 'CRYPTOCURRENCY' }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('BTC-USD', { yahoo, tickers });

    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ assetClass: 'CRYPTO' }),
    );
  });
});
