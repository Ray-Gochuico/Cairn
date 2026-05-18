import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock @tauri-apps/api/core before importing the module under test.
// `quoteSummary` now goes through the Rust `yahoo_quote_summary` command
// via `invoke` — see `src-tauri/src/yahoo.rs` for the full auth flow
// (cookie pre-flight + cached crumb). The JS side just hands ticker +
// modules to Rust and parses the returned JSON body string, so the
// cookie/crumb auth flow is not testable from Vitest. The Rust command
// is verified by the user running `npm run tauri dev` and clicking
// "Refresh fund data".
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { YahooClient } from '@/market/yahoo-client';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

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
    it('invokes the Rust command with ticker + modules and parses the returned JSON', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      const result = await client.quoteSummary('VTI', ['topHoldings']);

      expect(mockInvoke).toHaveBeenCalledOnce();
      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'VTI',
        modules: ['topHoldings'],
      });
      expect(result).toEqual(topHoldingsFixture);
    });

    it('passes tickers verbatim (Rust handles URL encoding)', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify({}));

      await client.quoteSummary('BRK-B', ['topHoldings']);

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'BRK-B',
        modules: ['topHoldings'],
      });
    });

    it('passes multiple modules as an array (Rust joins them with a comma)', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify({}));

      await client.quoteSummary('VTI', ['fundProfile', 'price']);

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'VTI',
        modules: ['fundProfile', 'price'],
      });
    });

    it('propagates Rust errors as thrown errors', async () => {
      // Tauri's `invoke` rejects with the Result::Err string when the Rust
      // command returns Err. We forward that to the caller unchanged.
      mockInvoke.mockRejectedValueOnce('yahoo quoteSummary BOGUS failed: 404 Not Found');

      await expect(client.quoteSummary('BOGUS', ['topHoldings'])).rejects.toEqual(
        'yahoo quoteSummary BOGUS failed: 404 Not Found'
      );
    });
  });

  describe('fundTopHoldings', () => {
    it('returns mapped holdings with symbol and weight from fixture', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toHaveLength(2);
      expect(result.holdings[0]).toEqual({ symbol: 'AAPL', weight: 0.0762 });
      expect(result.holdings[1]).toEqual({ symbol: 'MSFT', weight: 0.0651 });
      // asOf should be today's date in YYYY-MM-DD format
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when Yahoo returns no topHoldings block', async () => {
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(emptyResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when result array is null', async () => {
      const noResultResponse = { quoteSummary: { result: null, error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noResultResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
    });

    it('invokes the Rust command with modules=[topHoldings]', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      await client.fundTopHoldings('VTI');

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'VTI',
        modules: ['topHoldings'],
      });
    });
  });

  describe('fundProfile', () => {
    it('returns category and quoteType from fixture', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(fundProfileFixture));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: 'Large Blend', quoteType: 'ETF' });
    });

    it('returns nulls when fields are missing', async () => {
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(emptyResponse));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: null, quoteType: null });
    });

    it('invokes the Rust command with modules=[fundProfile, price]', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(fundProfileFixture));

      await client.fundProfile('VTI');

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'VTI',
        modules: ['fundProfile', 'price'],
      });
    });
  });
});
