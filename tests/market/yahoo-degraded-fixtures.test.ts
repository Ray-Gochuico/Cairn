/**
 * OWNER CONSTRAINT (Ray, 2026-07-02): Yahoo boundary hardening must be
 * salvage-preserving — no response that produces data today may produce less
 * data under new code. These fixtures capture the degraded shapes the ad-hoc
 * guards in src/market/yahoo-client.ts tolerate; the assertions pin the
 * EXACT current extraction. Any future refactor of the client must keep
 * every one green byte-identical. See the fixture↔guard table in
 * docs/superpowers/plans/2026-07-02-wave-5-infrastructure.md Task 14.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { YahooClient } from '@/market/yahoo-client';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/yahoo-degraded', name), 'utf-8'),
  );
}

/** Chart endpoint responses arrive via plugin-http fetch. */
function mockChartResponse(name: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => fixture(name),
  });
}

/** quoteSummary responses arrive as a JSON string from the Rust command. */
function mockQuoteSummary(name: string): void {
  mockInvoke.mockResolvedValueOnce(JSON.stringify(fixture(name)));
}

describe('Yahoo degraded-shape fixtures (salvage characterization)', () => {
  let client: YahooClient;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new YahooClient();
    vi.clearAllMocks();
    // Silence (and capture) the Path A observe-only warns so degraded
    // fixtures don't spam test output. Restored by tests/setup.ts afterEach.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ── chart endpoint (quote / historical) ──────────────────────────────

  it('F1 missing prevClose+currency: quote() salvages — changePct 0, USD default', async () => {
    mockChartResponse('chart-missing-prevclose-currency.json');
    const q = await client.quote('TEST');
    expect(q.price).toBe(123.45);
    expect(q.changePct).toBe(0);
    expect(q.currency).toBe('USD');
    expect(q.ticker).toBe('TEST');
  });

  it('F2 null result array: quote() and historical() throw their documented errors', async () => {
    mockChartResponse('chart-null-result.json');
    await expect(client.quote('TEST')).rejects.toThrow('No quote data for TEST');
    mockChartResponse('chart-null-result.json');
    await expect(client.historical('TEST', '2026-06-30')).rejects.toThrow(
      'No historical chart data for TEST on 2026-06-30',
    );
  });

  it('F3 missing regularMarketPrice: quote() throws (no fabricated price)', async () => {
    mockChartResponse('chart-missing-price.json');
    await expect(client.quote('TEST')).rejects.toThrow('No regularMarketPrice for TEST');
  });

  it('F4 chart.error object: fetchChart surfaces the Yahoo description', async () => {
    mockChartResponse('chart-error-object.json');
    await expect(client.quote('TEST')).rejects.toThrow(
      'Yahoo error for TEST: No data found, symbol may be delisted',
    );
  });

  it('F5 weekend null close bar: historical() throws No close price', async () => {
    mockChartResponse('chart-weekend-null-close.json');
    await expect(client.historical('TEST', '2026-06-28')).rejects.toThrow(
      'No close price for TEST on 2026-06-28',
    );
  });

  it('empty indicators.quote array (inline): historical() throws No close price', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 50 }, indicators: { quote: [] } }],
          error: null,
        },
      }),
    });
    await expect(client.historical('TEST', '2026-06-30')).rejects.toThrow(
      'No close price for TEST on 2026-06-30',
    );
  });

  // ── quoteSummary endpoint (Rust command) ─────────────────────────────

  it('F6 missing topHoldings block: empty holdings AND empty sectors, never a throw', async () => {
    mockQuoteSummary('qs-missing-topholdings.json');
    expect((await client.fundTopHoldings('VTI')).holdings).toEqual([]);
    mockQuoteSummary('qs-missing-topholdings.json');
    expect((await client.fundSectorWeightings('VTI')).sectors).toEqual([]);
  });

  it('F7 partial holding rows: per-ROW salvage (weight→0, name→null, symbol-less dropped)', async () => {
    mockQuoteSummary('qs-partial-holdings.json');
    const { holdings } = await client.fundTopHoldings('VTI');
    expect(holdings).toEqual([
      { symbol: 'AAPL', weight: 0.07, name: 'Apple Inc' },
      { symbol: 'MSFT', weight: 0, name: null },
      { symbol: 'NVDA', weight: 0.04, name: null },
    ]);
  });

  it('F8 degenerate sector entries: per-ENTRY salvage keeps only valid positive weights', async () => {
    mockQuoteSummary('qs-degenerate-sectors.json');
    const { sectors } = await client.fundSectorWeightings('VTI');
    expect(sectors).toEqual([
      { sector: 'Real Estate', weight: 0.12 },
      { sector: 'Financial Services', weight: 0.2 },
    ]);
  });

  it('F9 missing modules: fundProfile and assetProfile return all-null, never throw', async () => {
    mockQuoteSummary('qs-missing-modules.json');
    expect(await client.fundProfile('VTI')).toEqual({ category: null, quoteType: null });
    mockQuoteSummary('qs-missing-modules.json');
    expect(await client.assetProfile('VTI')).toEqual({ sector: null, industry: null });
  });

  it('F10 unknown/extra fields pass through: extraction identical, all four wrappers', async () => {
    mockQuoteSummary('qs-unknown-fields.json');
    expect((await client.fundTopHoldings('VTI')).holdings).toEqual([
      { symbol: 'AAPL', weight: 0.07, name: 'Apple Inc' },
    ]);
    mockQuoteSummary('qs-unknown-fields.json');
    expect((await client.fundSectorWeightings('VTI')).sectors).toEqual([
      { sector: 'Technology', weight: 0.3 },
    ]);
    mockQuoteSummary('qs-unknown-fields.json');
    expect(await client.fundProfile('VTI')).toEqual({ category: 'Large Blend', quoteType: 'ETF' });
    mockQuoteSummary('qs-unknown-fields.json');
    expect(await client.assetProfile('VTI')).toEqual({
      sector: 'Technology',
      industry: 'Software',
    });
    void warnSpy; // asserted in the Path A describe below (appended in Step 4)
  });
});
