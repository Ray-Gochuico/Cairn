import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// The chart path (`quote()` / `historical()`) transports through
// @tauri-apps/plugin-http's `fetch` (Rust shell, no CORS) — NOT the global
// fetch — so failure-path tests mock the module seam. Default: unset; only
// the round-2 D4 failure tests program it (no earlier test touches charts).
const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
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
    it('returns mapped holdings with symbol, weight, and name from fixture', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toHaveLength(2);
      expect(result.holdings[0]).toEqual({ symbol: 'AAPL', weight: 0.0762, name: 'Apple Inc' });
      expect(result.holdings[1]).toEqual({ symbol: 'MSFT', weight: 0.0651, name: 'Microsoft Corp' });
      // asOf should be today's date in YYYY-MM-DD format
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('falls back to name=null when holdingName is absent', async () => {
      const noNameResponse = {
        quoteSummary: {
          result: [{ topHoldings: { holdings: [{ symbol: 'NVDA', holdingPercent: { raw: 0.05 } }] } }],
          error: null,
        },
      };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noNameResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings[0]).toEqual({ symbol: 'NVDA', weight: 0.05, name: null });
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

  describe('fundSectorWeightings', () => {
    it('returns mapped sectors with human-readable names and weights', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      const result = await client.fundSectorWeightings('VTI');

      // Yahoo returns 11 GICS sectors as `[{snake_case: {raw: 0.xxx}}, ...]`.
      // We map snake_case → "Title Case" so the donut labels look like the
      // assetProfile-driven sectors for individual equities (e.g. "Technology"
      // not "technology"). Verifies a few representative rows.
      const tech = result.sectors.find((s) => s.sector === 'Technology');
      const fin = result.sectors.find((s) => s.sector === 'Financial Services');
      const real = result.sectors.find((s) => s.sector === 'Real Estate');
      const comm = result.sectors.find((s) => s.sector === 'Communication Services');
      expect(tech?.weight).toBeCloseTo(0.2865, 4);
      expect(fin?.weight).toBeCloseTo(0.1402, 4);
      expect(real?.weight).toBeCloseTo(0.0291, 4);
      expect(comm?.weight).toBeCloseTo(0.0813, 4);
      expect(result.sectors).toHaveLength(11);
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty sectors when Yahoo omits sectorWeightings', async () => {
      const noSectorsResponse = {
        quoteSummary: { result: [{ topHoldings: { holdings: [] } }], error: null },
      };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noSectorsResponse));

      const result = await client.fundSectorWeightings('VTI');

      expect(result.sectors).toEqual([]);
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty sectors when result array is null', async () => {
      const noResultResponse = { quoteSummary: { result: null, error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noResultResponse));

      const result = await client.fundSectorWeightings('VTI');

      expect(result.sectors).toEqual([]);
    });

    it('drops entries with zero weight (Yahoo emits these for non-equity funds)', async () => {
      const zeroWeightResponse = {
        quoteSummary: {
          result: [{
            topHoldings: {
              sectorWeightings: [
                { technology: { raw: 0.3 } },
                { healthcare: { raw: 0 } },
                { financial_services: { raw: 0.2 } },
              ],
            },
          }],
          error: null,
        },
      };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(zeroWeightResponse));

      const result = await client.fundSectorWeightings('VTI');

      expect(result.sectors).toHaveLength(2);
      expect(result.sectors.map((s) => s.sector).sort()).toEqual([
        'Financial Services', 'Technology',
      ]);
    });

    it('invokes the Rust command with modules=[topHoldings]', async () => {
      mockInvoke.mockResolvedValueOnce(JSON.stringify(topHoldingsFixture));

      await client.fundSectorWeightings('VTI');

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'VTI',
        modules: ['topHoldings'],
      });
    });
  });

  describe('assetProfile', () => {
    it('returns sector and industry from Yahoo quoteSummary assetProfile module', async () => {
      const response = {
        quoteSummary: {
          result: [{ assetProfile: { sector: 'Technology', industry: 'Software—Infrastructure' } }],
          error: null,
        },
      };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(response));

      const result = await client.assetProfile('AAPL');

      expect(result).toEqual({ sector: 'Technology', industry: 'Software—Infrastructure' });
    });

    it('returns nulls when fields are missing', async () => {
      const emptyResponse = { quoteSummary: { result: [{ assetProfile: {} }], error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(emptyResponse));

      const result = await client.assetProfile('XYZ');

      expect(result).toEqual({ sector: null, industry: null });
    });

    it('returns nulls when assetProfile module is missing entirely', async () => {
      const noModuleResponse = { quoteSummary: { result: [{}], error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noModuleResponse));

      const result = await client.assetProfile('XYZ');

      expect(result).toEqual({ sector: null, industry: null });
    });

    it('returns nulls when result array is null', async () => {
      const noResultResponse = { quoteSummary: { result: null, error: null } };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(noResultResponse));

      const result = await client.assetProfile('XYZ');

      expect(result).toEqual({ sector: null, industry: null });
    });

    it('invokes the Rust command with modules=[assetProfile]', async () => {
      const response = {
        quoteSummary: {
          result: [{ assetProfile: { sector: 'Technology', industry: 'Software—Infrastructure' } }],
          error: null,
        },
      };
      mockInvoke.mockResolvedValueOnce(JSON.stringify(response));

      await client.assetProfile('AAPL');

      expect(mockInvoke).toHaveBeenCalledWith('yahoo_quote_summary', {
        ticker: 'AAPL',
        modules: ['assetProfile'],
      });
    });
  });

  describe('failure paths (round-2 D4)', () => {
    afterEach(() => {
      mockFetch.mockReset();
    });

    it('chart fetch surfaces a non-ok response as a thrown error with ticker + status', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });
      await expect(client.quote('VTI')).rejects.toThrow(
        'Yahoo chart fetch failed for VTI: 429 Too Many Requests',
      );
    });

    it('chart fetch propagates a transport-level rejection (offline)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Load failed'));
      await expect(client.quote('VTI')).rejects.toThrow('Load failed');
    });

    it('malformed invoke JSON rejects quoteSummary with a SyntaxError (JSON.parse path)', async () => {
      // quoteSummary console.errors before rethrowing — silence for a clean run.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvoke.mockResolvedValueOnce('{not json');
      await expect(client.quoteSummary('VTI', ['topHoldings'])).rejects.toThrow(SyntaxError);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
