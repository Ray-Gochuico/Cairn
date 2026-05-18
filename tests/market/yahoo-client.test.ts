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

/**
 * Builds a fake Response for the fc.yahoo.com cookie-issuing endpoint.
 * The real endpoint returns 404 in body, but we only care about the
 * Set-Cookie headers. We expose them via `Headers.getSetCookie()` since
 * that's what the modern fetch spec uses (and what our helper prefers).
 */
function makeCookieResponse(cookies: string[]) {
  const headers = new Headers();
  // Headers in Node ships with getSetCookie() in 20+; expose our test
  // cookies through it so the client picks them up via the modern path.
  (headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => cookies;
  return {
    ok: false, // fc.yahoo.com returns 404; client should NOT check .ok here.
    status: 404,
    headers,
  };
}

/**
 * Builds a fake Response for the v1/test/getcrumb endpoint. Body is the
 * raw crumb string.
 */
function makeCrumbResponse(crumb: string) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(crumb),
  };
}

/**
 * Sets up the cookie + crumb pre-flight mocks. Pair this with subsequent
 * mockResolvedValueOnce calls for the actual quoteSummary response(s).
 */
function mockAuthPreflight(cookies = ['A3=abc123; Path=/; Domain=.yahoo.com', 'B=xyz789'], crumb = 'TestCrumb_42') {
  mockFetch.mockResolvedValueOnce(makeCookieResponse(cookies));
  mockFetch.mockResolvedValueOnce(makeCrumbResponse(crumb));
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

  describe('quoteSummary auth flow', () => {
    it('first call performs cookie + crumb pre-flight, then calls quoteSummary with crumb', async () => {
      mockAuthPreflight(['A3=abc123; Path=/', 'B=xyz789; Path=/'], 'TestCrumb_42');
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.quoteSummary('VTI', ['topHoldings']);

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // 1st: fc.yahoo.com cookie-issuing endpoint
      const [cookieUrl, cookieOpts] = mockFetch.mock.calls[0];
      expect(cookieUrl).toBe('https://fc.yahoo.com');
      expect(cookieOpts).toEqual({ method: 'GET' });

      // 2nd: getcrumb endpoint, with Cookie header carrying just the name=value pairs
      const [crumbUrl, crumbOpts] = mockFetch.mock.calls[1];
      expect(crumbUrl).toBe('https://query1.finance.yahoo.com/v1/test/getcrumb');
      expect(crumbOpts).toEqual({
        method: 'GET',
        headers: { Cookie: 'A3=abc123; B=xyz789' },
      });

      // 3rd: actual quoteSummary with crumb appended + Cookie header
      const [qsUrl, qsOpts] = mockFetch.mock.calls[2];
      expect(qsUrl).toBe(
        'https://query2.finance.yahoo.com/v10/finance/quoteSummary/VTI?modules=topHoldings&crumb=TestCrumb_42'
      );
      expect(qsOpts).toEqual({
        method: 'GET',
        headers: { Cookie: 'A3=abc123; B=xyz789' },
      });
      expect(result).toEqual(topHoldingsFixture);
    });

    it('caches cookie + crumb across calls (no re-fetch within TTL)', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));
      mockFetch.mockResolvedValueOnce(makeOkResponse(fundProfileFixture));

      await client.quoteSummary('VTI', ['topHoldings']);
      await client.quoteSummary('VTI', ['fundProfile']);

      // 4 calls total: 1 cookie + 1 crumb + 2 quoteSummary. The second call
      // reuses the cached cookie + crumb without re-hitting fc.yahoo.com
      // or getcrumb.
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[0][0]).toBe('https://fc.yahoo.com');
      expect(mockFetch.mock.calls[1][0]).toBe('https://query1.finance.yahoo.com/v1/test/getcrumb');
      expect(mockFetch.mock.calls[2][0]).toContain('quoteSummary/VTI?modules=topHoldings');
      expect(mockFetch.mock.calls[3][0]).toContain('quoteSummary/VTI?modules=fundProfile');
    });

    it('retries once with fresh auth on a 401 response', async () => {
      mockAuthPreflight(['A3=oldcookie'], 'OldCrumb');
      // First quoteSummary call: 401 (cookies stale mid-session)
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401));
      // Re-auth: fresh cookie + crumb
      mockAuthPreflight(['A3=newcookie'], 'NewCrumb');
      // Retry quoteSummary: success
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.quoteSummary('VTI', ['topHoldings']);

      expect(mockFetch).toHaveBeenCalledTimes(6);
      // The retry quoteSummary uses the NEW crumb
      const [retryUrl, retryOpts] = mockFetch.mock.calls[5];
      expect(retryUrl).toContain('crumb=NewCrumb');
      expect(retryOpts).toEqual({
        method: 'GET',
        headers: { Cookie: 'A3=newcookie' },
      });
      expect(result).toEqual(topHoldingsFixture);
    });

    it('throws when both initial and retry quoteSummary return 401', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401));
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401));

      await expect(client.quoteSummary('VTI', ['topHoldings'])).rejects.toThrow(
        'Yahoo quoteSummary VTI failed: 401'
      );
    });

    it('throws when fc.yahoo.com returns no Set-Cookie headers', async () => {
      const emptyHeaders = new Headers();
      (emptyHeaders as unknown as { getSetCookie: () => string[] }).getSetCookie = () => [];
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: emptyHeaders });

      await expect(client.quoteSummary('VTI', ['topHoldings'])).rejects.toThrow(
        'Yahoo cookie endpoint returned no Set-Cookie headers'
      );
    });

    it('throws when getcrumb returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(makeCookieResponse(['A3=abc']));
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

      await expect(client.quoteSummary('VTI', ['topHoldings'])).rejects.toThrow(
        'Yahoo getcrumb failed: 500'
      );
    });

    it('falls back to .get(set-cookie) when getSetCookie() is unavailable', async () => {
      // Simulate an older fetch implementation: only the joined comma-
      // delimited string is exposed via .get('set-cookie'). Hand-built
      // headers object with no getSetCookie() method.
      const joined =
        'A3=abc123; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, B=xyz789; Path=/';
      const fakeHeaders = {
        get: (name: string) => (name.toLowerCase() === 'set-cookie' ? joined : null),
        // No getSetCookie method — forces the fallback path.
      } as unknown as Headers;
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: fakeHeaders });
      mockFetch.mockResolvedValueOnce(makeCrumbResponse('FallbackCrumb'));
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      await client.quoteSummary('VTI', ['topHoldings']);

      const [crumbUrl, crumbOpts] = mockFetch.mock.calls[1];
      expect(crumbUrl).toBe('https://query1.finance.yahoo.com/v1/test/getcrumb');
      // Both cookies should make it through, with the Expires date comma
      // not being mistakenly treated as a cookie separator (the regex
      // lookahead requires `name=` to follow the comma, and "21 Oct" /
      // "GMT" don't match).
      expect((crumbOpts as { headers: { Cookie: string } }).headers.Cookie).toBe(
        'A3=abc123; B=xyz789'
      );
    });
  });

  describe('quoteSummary', () => {
    it('constructs the correct URL and returns parsed JSON', async () => {
      mockAuthPreflight(['A3=c1'], 'CrumbA');
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.quoteSummary('VTI', ['topHoldings']);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [url, options] = mockFetch.mock.calls[2];
      expect(url).toBe(
        'https://query2.finance.yahoo.com/v10/finance/quoteSummary/VTI?modules=topHoldings&crumb=CrumbA'
      );
      expect(options).toEqual({ method: 'GET', headers: { Cookie: 'A3=c1' } });
      expect(result).toEqual(topHoldingsFixture);
    });

    it('encodes special characters in ticker (e.g. BRK-B)', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));

      await client.quoteSummary('BRK-B', ['topHoldings']);

      const [url] = mockFetch.mock.calls[2];
      expect(url).toContain('BRK-B');
      // encodeURIComponent('BRK-B') === 'BRK-B' — hyphen is not encoded,
      // but the test ensures the path segment is correct either way.
      expect(url).toMatch(/quoteSummary\/BRK/);
    });

    it('joins multiple modules with a comma', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));

      await client.quoteSummary('VTI', ['fundProfile', 'price']);

      const [url] = mockFetch.mock.calls[2];
      // modules are joined with a literal comma (not URL-encoded); Yahoo accepts both forms.
      expect(url).toContain('modules=fundProfile,price');
    });

    it('throws on a non-ok response (non-auth error)', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

      await expect(client.quoteSummary('BOGUS', ['topHoldings'])).rejects.toThrow(
        'Yahoo quoteSummary BOGUS failed: 404'
      );
    });
  });

  describe('fundTopHoldings', () => {
    it('returns mapped holdings with symbol and weight from fixture', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toHaveLength(2);
      expect(result.holdings[0]).toEqual({ symbol: 'AAPL', weight: 0.0762 });
      expect(result.holdings[1]).toEqual({ symbol: 'MSFT', weight: 0.0651 });
      // asOf should be today's date in YYYY-MM-DD format
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when Yahoo returns no topHoldings block', async () => {
      mockAuthPreflight();
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns empty holdings when result array is null', async () => {
      mockAuthPreflight();
      const noResultResponse = { quoteSummary: { result: null, error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(noResultResponse));

      const result = await client.fundTopHoldings('VTI');

      expect(result.holdings).toEqual([]);
    });

    it('hits quoteSummary with modules=topHoldings', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse(topHoldingsFixture));

      await client.fundTopHoldings('VTI');

      const [url] = mockFetch.mock.calls[2];
      expect(url).toContain('modules=topHoldings');
    });
  });

  describe('fundProfile', () => {
    it('returns category and quoteType from fixture', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse(fundProfileFixture));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: 'Large Blend', quoteType: 'ETF' });
    });

    it('returns nulls when fields are missing', async () => {
      mockAuthPreflight();
      const emptyResponse = { quoteSummary: { result: [{}], error: null } };
      mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse));

      const result = await client.fundProfile('VTI');

      expect(result).toEqual({ category: null, quoteType: null });
    });

    it('hits quoteSummary with modules=fundProfile,price', async () => {
      mockAuthPreflight();
      mockFetch.mockResolvedValueOnce(makeOkResponse(fundProfileFixture));

      await client.fundProfile('VTI');

      const [url] = mockFetch.mock.calls[2];
      expect(url).toContain('modules=fundProfile');
      expect(url).toContain('price');
    });
  });
});
