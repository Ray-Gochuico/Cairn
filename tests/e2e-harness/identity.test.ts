// @vitest-environment node
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertServerIdentity, fetchDevStamp } from '../../e2e/identity';
import { E2E_ROOT, E2E_SERVERS, FRESH_SERVER, SEEDED_SERVER } from '../../e2e/servers';
import { DEV_ROLE_PORTS, DEV_STAMP_PATH, type DevStamp } from '../../scripts/dev-servers';

const stamp = (over: Partial<DevStamp> = {}): DevStamp => ({
  root: '/trees/main',
  role: 'seed',
  port: 1422,
  seed: true,
  nonce: 'run-1',
  pid: 42,
  head: 'a'.repeat(40),
  cacheDir: '/trees/main/.vite.local/seed',
  ...over,
});
const expected = { root: '/trees/main', nonce: 'run-1', seed: true, port: 1422, label: 'seeded' };

describe('assertServerIdentity (W-I D-I3/D-I4)', () => {
  it('passes for the server this run launched from this tree', () => {
    expect(() => assertServerIdentity(stamp(), expected)).not.toThrow();
  });

  it('refuses a server from ANOTHER tree, naming both roots and the port to free', () => {
    expect(() => assertServerIdentity(stamp({ root: '/trees/w4' }), expected)).toThrow(
      /DIFFERENT tree[\s\S]*server root: \/trees\/w4[\s\S]*this tree: {3}\/trees\/main[\s\S]*lsof -nP -iTCP:1422/,
    );
  });

  it('refuses a same-tree server this run did not launch (nonce mismatch or none)', () => {
    expect(() => assertServerIdentity(stamp({ nonce: 'stale' }), expected)).toThrow(
      /not launched by this Playwright run \(nonce stale ≠ run-1\)/,
    );
    expect(() => assertServerIdentity(stamp({ nonce: null }), expected)).toThrow(/nonce none ≠ run-1/);
  });

  it('under opt-in reuse (expected.nonce null) the launcher is waived but the tree still is not', () => {
    const reuse = { ...expected, nonce: null };
    expect(() => assertServerIdentity(stamp({ nonce: null }), reuse)).not.toThrow();
    expect(() => assertServerIdentity(stamp({ nonce: null, root: '/trees/w4' }), reuse)).toThrow(
      /DIFFERENT tree/,
    );
  });

  it('refuses a server of the wrong role on this port', () => {
    expect(() => assertServerIdentity(stamp({ seed: false, role: 'fresh' }), expected)).toThrow(
      /reports seed=false; this project expects seed=true \(server role fresh\)/,
    );
  });

  it('every message keeps the calm register', () => {
    const messages: string[] = [];
    for (const bad of [stamp({ root: '/x' }), stamp({ nonce: null }), stamp({ seed: false })]) {
      try {
        assertServerIdentity(bad, expected);
      } catch (e) {
        messages.push((e as Error).message);
      }
    }
    expect(messages).toHaveLength(3);
    for (const m of messages) {
      expect(m).not.toMatch(/!/);
      expect(m).not.toMatch(/you should/i);
    }
  });
});

async function serve(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = http.createServer(handler);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => srv.close(() => resolve())),
  };
}

describe('fetchDevStamp', () => {
  it('reads a stamped server at DEV_STAMP_PATH', async () => {
    const good = await serve((req, res) => {
      expect(req.url).toBe(DEV_STAMP_PATH);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(stamp()));
    });
    await expect(fetchDevStamp(good.url)).resolves.toMatchObject({ role: 'seed', root: '/trees/main' });
    await good.close();
  });

  it('refuses an SPA fallback (200 text/html — a Vite server from a tree WITHOUT the plugin answers every path with index.html)', async () => {
    const html = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div>');
    });
    await expect(fetchDevStamp(html.url)).rejects.toThrow(
      /not a Cairn dev server built from a tree that carries the dev-stamp plugin/,
    );
    await html.close();
  });
});

describe('e2e/servers.ts — the two servers and this tree', () => {
  it('E2E_ROOT is the repository root Playwright runs from', () => {
    expect(E2E_ROOT).toBe(path.resolve(__dirname, '..', '..'));
  });
  it('seeded/fresh map onto the seed/fresh roles and their fixed ports', () => {
    expect(E2E_SERVERS).toEqual([SEEDED_SERVER, FRESH_SERVER]);
    expect(SEEDED_SERVER).toMatchObject({
      role: 'seed',
      port: DEV_ROLE_PORTS.seed,
      seed: true,
      script: 'dev:browser:seed',
      url: 'http://localhost:1422',
    });
    expect(FRESH_SERVER).toMatchObject({
      role: 'fresh',
      port: DEV_ROLE_PORTS.fresh,
      seed: false,
      script: 'dev:browser:fresh',
      url: 'http://localhost:1423',
    });
  });
});
