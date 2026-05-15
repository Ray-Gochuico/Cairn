import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock @tauri-apps/plugin-http before importing the module under test.
// YahooClient imports `fetch` from this package; vi.mock replaces it with
// a controllable spy so no real network calls are made.
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { fetch } from '@tauri-apps/plugin-http';
import { YahooClient } from '@/market/yahoo-client';

const mockFetch = fetch as ReturnType<typeof vi.fn>;

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

const topHoldingsFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/yahoo-topholdings-vti.json'), 'utf-8')
);

const fundProfileFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/yahoo-fundprofile-vti.json'), 'utf-8')
);

describe('YahooClient', () => {
  let client: YahooClient;

  beforeEach(() => {
    client = new YahooClient();
    vi.clearAllMocks();
  });

  describe('quoteSummary', () => {
    it('constructs the correct URL and returns parsed JSON', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.quoteSummary('VTI', ['topHoldings']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://query2.finance.yahoo.com/v10/finance/quoteSummary/VTI?modules=topHoldings'
      );
      expect(options).toEqual({ method: 'GET' });
      expect(result).toEqual(topHoldingsFixture);
    });

    it('encodes special characters in ticker (e.g. BRK-B)', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));

      await client.quoteSummary('BRK-B', ['topHoldings']);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('BRK-B');
      // encodeURIComponent('BRK-B') === 'BRK-B' — hyphen is not encoded,
      // but the test ensures the path segment is correct either way.
      expect(url).toMatch(/quoteSummary\/BRK/);
    });

    it('joins multiple modules with a comma', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));

      await client.quoteSummary('VTI', ['fundProfile', 'price']);

      const [url] = mockFetch.mock.calls[0];
      // modules are joined with a literal comma (not URL-encoded); Yahoo accepts both forms.
      expect(url).toContain('modules=fundProfile,price');
    });

    it('throws on a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

      await expect(client.quoteSummary('BOGUS', ['topHoldings'])).rejects.toThrow(
        'Yahoo quoteSummary BOGUS failed: 404'
      );
    });
  });

  describe('fundTopHoldings', () => {
    it('returns mapped holdings with symbol and weight from fixture', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toHaveLength(2);
      expect(result.holdings[0]).toEqual({ symbol: 'AAPL', weight: 0.0762 });
      expect(result.holdings[1]).toEqual({ symbol: 'MSFT', weight: 0.0651 });
      // asOf should be today's date in YYYY-MM-DD format
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when Yahoo returns no topHoldings block', async () => {
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when result array is null', async () => {
      const noResultResponse = { quoteSummary: { result: null, error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(noResultResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
    });

    it('hits quoteSummary with modules=topHoldings', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      await client.fundTopHoldings('VTI');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('modules=topHoldings');
    });
  });

  describe('fundProfile', () => {
    it('returns category and quoteType from fixture', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(fundProfileFixture));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: 'Large Blend', quoteType: 'ETF' });
    });

    it('returns nulls when fields are missing', async () => {
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: null, quoteType: null });
    });

    it('hits quoteSummary with modules=fundProfile,price', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(fundProfileFixture));

      await client.fundProfile('VTI');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('modules=fundProfile');
      expect(url).toContain('price');
    });
  });
});
