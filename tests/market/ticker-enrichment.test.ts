import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { YahooClient } from '@/market/yahoo-client';
import type { TickersRepo } from '@/domain/tickers';
import type { Ticker } from '@/types/schema';
import { enrichTickerIfMissing } from '@/market/ticker-enrichment';

function makeYahooMock(
  overrides: Partial<{
    fundProfile: ReturnType<typeof vi.fn>;
    assetProfile: ReturnType<typeof vi.fn>;
  }> = {},
): YahooClient {
  return {
    fundProfile: vi.fn().mockResolvedValue({ category: null, quoteType: null }),
    assetProfile: vi.fn().mockResolvedValue({ sector: null, industry: null }),
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
  sector: null,
  industry: null,
};

describe('enrichTickerIfMissing', () => {
  it('returns immediately when ticker already exists and sector is set', async () => {
    const yahoo = makeYahooMock();
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue({
        ...existingTicker,
        sector: 'Technology',
        industry: 'Software—Infrastructure',
      }),
    });

    await enrichTickerIfMissing('VTI', { yahoo, tickers });

    expect(tickers.lookup).toHaveBeenCalledWith('VTI');
    expect(yahoo.fundProfile).not.toHaveBeenCalled();
    expect(yahoo.assetProfile).not.toHaveBeenCalled();
    expect(tickers.upsert).not.toHaveBeenCalled();
  });

  it('fetches Yahoo fundProfile + assetProfile and upserts when ticker is missing', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockResolvedValue({ category: 'Large Blend', quoteType: 'ETF' }),
      assetProfile: vi.fn().mockResolvedValue({
        sector: 'Technology',
        industry: 'Software—Infrastructure',
      }),
    });
    const tickers = makeTickersMock();

    await enrichTickerIfMissing('VTI', { yahoo, tickers });

    expect(yahoo.fundProfile).toHaveBeenCalledWith('VTI');
    expect(yahoo.assetProfile).toHaveBeenCalledWith('VTI');
    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'VTI',
        assetClass: 'US_LARGE_CAP',
        leverageFactor: 1,
        direction: 'LONG',
        userAdded: false,
        sector: 'Technology',
        industry: 'Software—Infrastructure',
      }),
    );
  });

  it('re-enriches existing ticker when sector is null, preserving name/assetClass/leverage', async () => {
    const yahoo = makeYahooMock({
      assetProfile: vi.fn().mockResolvedValue({
        sector: 'Technology',
        industry: 'Software—Infrastructure',
      }),
    });
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue(existingTicker),
    });

    await enrichTickerIfMissing('VTI', { yahoo, tickers });

    // assetProfile fills in sector; fundProfile NOT called since other fields are already set
    expect(yahoo.assetProfile).toHaveBeenCalledWith('VTI');
    expect(yahoo.fundProfile).not.toHaveBeenCalled();
    expect(tickers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'VTI',
        name: existingTicker.name,
        assetClass: existingTicker.assetClass,
        leverageFactor: existingTicker.leverageFactor,
        direction: existingTicker.direction,
        userAdded: existingTicker.userAdded,
        accentColor: existingTicker.accentColor,
        sector: 'Technology',
        industry: 'Software—Infrastructure',
      }),
    );
  });

  it('retries assetProfile on every call when Yahoo returns null sector (best-effort)', async () => {
    // Yahoo couldn't classify this ticker — sector stays null in the upsert.
    // Per spec: the next refresh must still attempt enrichment, because the
    // "should we enrich?" gate is purely existing.sector being null.
    const yahoo = makeYahooMock({
      assetProfile: vi.fn().mockResolvedValue({ sector: null, industry: null }),
    });
    const existingWithNullSector = { ...existingTicker, sector: null, industry: null };
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue(existingWithNullSector),
    });

    await enrichTickerIfMissing(existingTicker.ticker, { yahoo, tickers });
    await enrichTickerIfMissing(existingTicker.ticker, { yahoo, tickers });

    // Both calls attempted enrichment — sector-null means "retry next refresh"
    expect(yahoo.assetProfile).toHaveBeenCalledTimes(2);
    expect(tickers.upsert).toHaveBeenCalledTimes(2);
    // Upsert still happens; sector stays null
    expect(tickers.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ticker: existingTicker.ticker,
        sector: null,
        industry: null,
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

  it('inserts a stub row when Yahoo fails for an unknown ticker (best-effort)', async () => {
    const yahoo = makeYahooMock({
      fundProfile: vi.fn().mockRejectedValue(new Error('Yahoo network failure')),
    });
    const tickers = makeTickersMock();

    // Should not throw
    // (round-2 C2: now reports the stub write so callers refeed the store)
    await expect(enrichTickerIfMissing('BAD', { yahoo, tickers })).resolves.toBe(true);

    // Contract: an unclassified holding is detected by row-missing OR
    // name === null. The stub here lets the UI surface "needs attention"
    // without depending on Yahoo coming back.
    expect(tickers.upsert).toHaveBeenCalledTimes(1);
    expect(tickers.upsert).toHaveBeenCalledWith({
      ticker: 'BAD',
      name: null,
      assetClass: 'OTHER',
      leverageFactor: 1.0,
      direction: 'LONG',
      userAdded: false,
      accentColor: null,
      sector: null,
      industry: null,
    });
  });

  it('does NOT stub when Yahoo fails for an EXISTING ticker (preserves real metadata)', async () => {
    const yahoo = makeYahooMock({
      assetProfile: vi.fn().mockRejectedValue(new Error('Yahoo network failure')),
    });
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue(existingTicker),
    });

    // (round-2 C2: nothing written for an existing row on failure → false)
    await expect(enrichTickerIfMissing('VTI', { yahoo, tickers })).resolves.toBe(false);

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

describe('enrichTickerIfMissing return value (round-2 C2: did a row get written?)', () => {
  // Reuses the file's makeYahooMock/makeTickersMock/existingTicker fixtures
  // rather than duplicating them (the plan's deps()/row() fixtures are the
  // same shapes).
  it('returns false on the already-enriched early skip (no write)', async () => {
    const yahoo = makeYahooMock();
    const tickers = makeTickersMock({
      lookup: vi.fn().mockResolvedValue({ ...existingTicker, sector: 'Technology' }),
    });
    await expect(enrichTickerIfMissing('VTI', { yahoo, tickers })).resolves.toBe(false);
  });

  it('returns true when it re-enriches an existing sector-less row', async () => {
    const yahoo = makeYahooMock({
      assetProfile: vi.fn().mockResolvedValue({ sector: 'Technology', industry: 'Software' }),
    });
    const tickers = makeTickersMock({ lookup: vi.fn().mockResolvedValue({ ...existingTicker }) });
    await expect(enrichTickerIfMissing('VTI', { yahoo, tickers })).resolves.toBe(true);
  });

  it('returns true when it creates a brand-new enriched row', async () => {
    const yahoo = makeYahooMock({
      assetProfile: vi.fn().mockResolvedValue({ sector: 'Technology', industry: 'Software' }),
      fundProfile: vi.fn().mockResolvedValue({ category: 'Large Blend', quoteType: 'ETF' }),
    });
    const tickers = makeTickersMock();
    await expect(enrichTickerIfMissing('NEWT', { yahoo, tickers })).resolves.toBe(true);
  });

  it('returns true when Yahoo fails but the unclassified stub row is written', async () => {
    const yahoo = makeYahooMock({ assetProfile: vi.fn().mockRejectedValue(new Error('429')) });
    const tickers = makeTickersMock();
    await expect(enrichTickerIfMissing('NEWT', { yahoo, tickers })).resolves.toBe(true);
  });

  it('returns false when Yahoo fails for an EXISTING row (nothing written)', async () => {
    const yahoo = makeYahooMock({ assetProfile: vi.fn().mockRejectedValue(new Error('429')) });
    const tickers = makeTickersMock({ lookup: vi.fn().mockResolvedValue({ ...existingTicker }) });
    await expect(enrichTickerIfMissing('VTI', { yahoo, tickers })).resolves.toBe(false);
  });
});
