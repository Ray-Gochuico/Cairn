// @vitest-environment node
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertServerIdentity, fetchDevStamp, type ExpectedIdentity } from '../../e2e/identity';
import { E2E_ROOT, E2E_SERVERS, FRESH_SERVER, SEEDED_SERVER, e2eServersFor, type E2eServer } from '../../e2e/servers';
import { DEV_ROLE_PORTS, DEV_STAMP_PATH, type DevStamp } from '../../scripts/dev-servers';

const stamp = (over: Partial<DevStamp> = {}): DevStamp => ({
  root: '/trees/main',
  role: 'seed',
  port: 1422,
  seed: true,
  shim: true,
  nonce: 'run-1',
  pid: 42,
  head: 'a'.repeat(40),
  cacheDir: '/trees/main/.vite.local/seed',
  ...over,
});
const expected: ExpectedIdentity = {
  root: '/trees/main',
  nonce: 'run-1',
  seed: true,
  role: 'seed',
  shim: true,
  port: 1422,
  label: 'seeded',
};

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

  it('enforces the ROLE, not only the seed flag: a hand-started tauri-role server with VITE_SEED_DEMO=1 is refused', () => {
    // MINOR 4: role tauri optimizes deps into .vite.local/tauri — the very
    // per-role isolation T1 built — while still reporting seed=true.
    expect(() => assertServerIdentity(stamp({ role: 'tauri' }), expected)).toThrow(
      /reports role=tauri; this project expects role=seed/,
    );
    expect(() =>
      assertServerIdentity(stamp({ role: 'fresh', seed: false, port: 1423 }), {
        ...expected,
        role: 'fresh',
        seed: false,
        label: 'fresh',
        port: 1423,
      }),
    ).not.toThrow();
  });

  it('enforces the SHIM flag: a server resolving the real @tauri-apps modules is refused', () => {
    expect(() => assertServerIdentity(stamp({ shim: false }), expected)).toThrow(
      /reports shim=false; this project expects shim=true/,
    );
    // a stamp from a server that predates the shim field fails closed, too
    const old = stamp();
    delete (old as { shim?: boolean }).shim;
    expect(() => assertServerIdentity(old, expected)).toThrow(/shim=undefined/);
  });

  it('asserts the SERVED port (v1.7.1 A-6, CR-I-4): a stamp naming another port than the one this run derived is refused', () => {
    expect(() => assertServerIdentity(stamp({ port: 1522 }), expected)).toThrow(
      /reports port=1522; this project expects port=1422 \(E2E_PORT_BASE moves the seed and fresh ports together/,
    );
    expect(() => assertServerIdentity(stamp({ port: null }), expected)).toThrow(/reports port=none; this project expects port=1422/);
    // the shifted pair passes when both sides derived the same base
    expect(() =>
      assertServerIdentity(stamp({ port: 1523, role: 'fresh', seed: false }), {
        ...expected,
        role: 'fresh',
        seed: false,
        label: 'fresh',
        port: 1523,
      }),
    ).not.toThrow();
  });

  it('the port check comes LAST: a foreign tree on a shifted base is still reported as the wrong TREE (the more useful message)', () => {
    expect(() => assertServerIdentity(stamp({ root: '/trees/w4', port: 1522 }), expected)).toThrow(/DIFFERENT tree/);
    expect(() => assertServerIdentity(stamp({ shim: false, port: 1522 }), expected)).toThrow(/reports shim=false/);
  });

  it('compares TREES, not spellings: separators and a trailing slash are normalized (MINOR 3, Windows)', () => {
    const win = { ...expected, root: 'C:\\trees\\main' };
    expect(() => assertServerIdentity(stamp({ root: 'C:/trees/main' }), win)).not.toThrow();
    expect(() => assertServerIdentity(stamp({ root: 'C:/trees/main/' }), win)).not.toThrow();
    expect(() => assertServerIdentity(stamp({ root: '/trees/main/' }), expected)).not.toThrow();
    // a genuinely different tree is still a different tree
    expect(() => assertServerIdentity(stamp({ root: 'C:/trees/w4' }), win)).toThrow(
      /DIFFERENT tree/,
    );
  });

  it('every message keeps the calm register', () => {
    const messages: string[] = [];
    for (const bad of [
      stamp({ root: '/x' }),
      stamp({ nonce: null }),
      stamp({ seed: false }),
      stamp({ role: 'tauri' }),
      stamp({ shim: false }),
      stamp({ port: 1522 }),
    ]) {
      try {
        assertServerIdentity(bad, expected);
      } catch (e) {
        messages.push((e as Error).message);
      }
    }
    expect(messages).toHaveLength(6);
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
  it('seeded/fresh map onto the seed/fresh roles and the fixed D-I12 ports when E2E_PORT_BASE is unset', () => {
    const at = e2eServersFor({});
    expect(at.all).toEqual([at.seeded, at.fresh]);
    expect(at.seeded).toMatchObject({
      role: 'seed',
      port: DEV_ROLE_PORTS.seed,
      seed: true,
      shim: true,
      script: 'dev:browser:seed',
      url: 'http://localhost:1422',
    });
    expect(at.fresh).toMatchObject({
      role: 'fresh',
      port: DEV_ROLE_PORTS.fresh,
      seed: false,
      shim: true,
      script: 'dev:browser:fresh',
      url: 'http://localhost:1423',
    });
    // both e2e projects run the browser-shim app (identity enforces it)
    for (const s of at.all) expect(s.shim, s.name).toBe(true);
    expect(e2eServersFor({ E2E_PORT_BASE: '' })).toEqual(at);
  });

  it('E2E_PORT_BASE shifts both servers together (seed = base, fresh = base + 1) and changes nothing else about them', () => {
    const shifted = e2eServersFor({ E2E_PORT_BASE: '1522' });
    expect(shifted.seeded).toMatchObject({ port: 1522, url: 'http://localhost:1522' });
    expect(shifted.fresh).toMatchObject({ port: 1523, url: 'http://localhost:1523' });
    const rest = ({ port: _port, url: _url, ...other }: E2eServer) => other;
    expect(rest(shifted.seeded)).toEqual(rest(e2eServersFor({}).seeded));
    expect(rest(shifted.fresh)).toEqual(rest(e2eServersFor({}).fresh));
    expect(() => e2eServersFor({ E2E_PORT_BASE: '1420' })).toThrow(/E2E_PORT_BASE/);
  });

  it("the module-level constants are this process's env through the same builder (what playwright.config.ts and global-setup consume)", () => {
    const mine = e2eServersFor(process.env);
    expect(SEEDED_SERVER).toEqual(mine.seeded);
    expect(FRESH_SERVER).toEqual(mine.fresh);
    expect(E2E_SERVERS).toEqual(mine.all);
  });

  it('the module wiring reads THIS process\'s E2E_PORT_BASE (M11): a fresh import under the key moves the constants; without it they are the 1422/1423 literals', async () => {
    // The test above compares the constants to the SAME env, so `const THIS_RUN =
    // e2eServersFor({})` (the module ignoring the base) would pass it whenever the
    // test process has no base — CI and gate.sh. This arm re-imports the module
    // under a set base and again with none, restoring the direct literal pin.
    const before = process.env.E2E_PORT_BASE;
    try {
      delete process.env.E2E_PORT_BASE;
      vi.resetModules();
      const fixed = await import('../../e2e/servers');
      expect(fixed.SEEDED_SERVER.url).toBe('http://localhost:1422');
      expect(fixed.FRESH_SERVER.url).toBe('http://localhost:1423');

      process.env.E2E_PORT_BASE = '1522';
      vi.resetModules();
      const shifted = await import('../../e2e/servers');
      expect(shifted.SEEDED_SERVER.port).toBe(1522);
      expect(shifted.FRESH_SERVER.url).toBe('http://localhost:1523');
      expect(shifted.E2E_SERVERS.map((s) => s.port)).toEqual([1522, 1523]);
    } finally {
      if (before === undefined) delete process.env.E2E_PORT_BASE;
      else process.env.E2E_PORT_BASE = before;
      vi.resetModules();
    }
  });
});
