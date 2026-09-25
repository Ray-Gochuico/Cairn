// @vitest-environment node
import path from 'node:path';
import { loadConfigFromFile, resolveConfig, type Plugin, type UserConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEV_STAMP_PATH,
  devCacheDirFor,
  type DevRole,
  type DevStamp,
} from '../../scripts/dev-servers';

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(ROOT, 'vite.config.ts');
const ENV_KEYS = ['VITE_BROWSER_SHIM', 'VITE_SEED_DEMO', 'CAIRN_DEV_ROLE', 'CAIRN_DEV_NONCE', 'E2E_PORT_BASE'] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

/** Load vite.config.ts under `env` exactly as `vite serve`/`vite build` would. */
export async function loadViteConfig(
  env: Env,
  command: 'serve' | 'build' = 'serve',
): Promise<UserConfig> {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const loaded = await loadConfigFromFile(
    { command, mode: command === 'serve' ? 'development' : 'production' },
    CONFIG,
    ROOT,
  );
  if (!loaded) throw new Error('vite.config.ts did not load');
  return loaded.config;
}

export function flatPlugins(config: UserConfig): Plugin[] {
  return (config.plugins ?? [])
    .flat(Infinity)
    .filter((p): p is Plugin => !!p && typeof p === 'object' && 'name' in p);
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const ROLE_ENVS: Array<[DevRole, Env]> = [
  ['tauri', {}],
  ['browser', { VITE_BROWSER_SHIM: '1' }],
  ['seed', { VITE_BROWSER_SHIM: '1', VITE_SEED_DEMO: '1' }],
  ['fresh', { VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh' }],
];

describe('vite.config.ts — per-role, per-tree dep cache (W-I D-I1/D-I2)', () => {
  it('each server role optimizes deps in its own .vite.local/<role> under this tree', async () => {
    const dirs = new Set<string>();
    for (const [role, env] of ROLE_ENVS) {
      const cfg = await loadViteConfig(env);
      expect(cfg.cacheDir).toBe(devCacheDirFor(ROOT, role));
      dirs.add(cfg.cacheDir!);
    }
    expect(dirs.size).toBe(ROLE_ENVS.length);
  });
});

describe('vite.config.ts — the port follows the role (v1.7.1 A-6; CR-I-2: the defaults are byte-identical)', () => {
  it('tauri 1420, browser 1421 — unchanged', async () => {
    expect((await loadViteConfig({})).server?.port).toBe(1420);
    expect((await loadViteConfig({ VITE_BROWSER_SHIM: '1' })).server?.port).toBe(1421);
  });

  it('seed 1422 and fresh 1423 come from the config now — the two scripts pass no --port', async () => {
    expect(
      (await loadViteConfig({ VITE_BROWSER_SHIM: '1', VITE_SEED_DEMO: '1', CAIRN_DEV_ROLE: 'seed' })).server?.port,
    ).toBe(1422);
    expect((await loadViteConfig({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh' })).server?.port).toBe(1423);
    // D-I171-3: the role decides, however it was derived — a hand-started
    // VITE_SEED_DEMO=1 server with no --port is the seed role and gets 1422.
    expect((await loadViteConfig({ VITE_BROWSER_SHIM: '1', VITE_SEED_DEMO: '1' })).server?.port).toBe(1422);
  });

  it('E2E_PORT_BASE moves seed and fresh together and nothing else; strictPort stays on', async () => {
    const seed = await loadViteConfig({
      VITE_BROWSER_SHIM: '1',
      VITE_SEED_DEMO: '1',
      CAIRN_DEV_ROLE: 'seed',
      E2E_PORT_BASE: '1522',
    });
    const fresh = await loadViteConfig({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh', E2E_PORT_BASE: '1522' });
    expect(seed.server?.port).toBe(1522);
    expect(fresh.server?.port).toBe(1523);
    expect(seed.server?.strictPort).toBe(true);
    expect(fresh.server?.strictPort).toBe(true);
    expect((await loadViteConfig({ E2E_PORT_BASE: '1522' })).server?.port).toBe(1420);
    expect((await loadViteConfig({ VITE_BROWSER_SHIM: '1', E2E_PORT_BASE: '1522' })).server?.port).toBe(1421);
  });

  it('a bad E2E_PORT_BASE fails the config load — the CAIRN_DEV_ROLE typo precedent (Vite logs "failed to load config" once; expected)', async () => {
    await expect(
      loadViteConfig({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh', E2E_PORT_BASE: '1420' }),
    ).rejects.toThrow(/E2E_PORT_BASE must be an integer/);
  });

  // NOT an independent port receipt: askStamp's fake server echoes the port this
  // test passes in (`server.config.server.port = fake.port`, :90-91), and the stamp's
  // own port path is pinned at :137-147 / :163-171. This arm only shows the stamp
  // path is unchanged under a shifted base — role and port travel together.
  it('the stamp path is unchanged for a shifted port (echo through the fake; the role rides with it)', async () => {
    const cfg = await loadViteConfig({
      VITE_BROWSER_SHIM: '1',
      VITE_SEED_DEMO: '1',
      CAIRN_DEV_ROLE: 'seed',
      E2E_PORT_BASE: '1522',
    });
    const { body } = await askStamp(cfg, { root: ROOT, cacheDir: cfg.cacheDir!, port: cfg.server!.port! });
    expect(body.port).toBe(1522);
    expect(body.role).toBe('seed');
  });
});

class FakeRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  setHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }
  end(chunk: string) {
    this.body = chunk;
  }
}

/** Drive the plugin's configureServer with a fake connect server; return the JSON it answers. */
async function askStamp(
  cfg: UserConfig,
  fake: { root: string; cacheDir: string; port?: number },
): Promise<{ status: number; type: string; body: DevStamp }> {
  const plugin = flatPlugins(cfg).find((p) => p.name === 'cairn-dev-stamp');
  if (!plugin) throw new Error('cairn-dev-stamp plugin missing');
  const hook = plugin.configureServer;
  const configure = typeof hook === 'function' ? hook : hook?.handler;
  if (!configure) throw new Error('cairn-dev-stamp has no configureServer');
  const mounts: Array<{ route: string; handler: (req: unknown, res: FakeRes) => void }> = [];
  const server = {
    config: { root: fake.root, cacheDir: fake.cacheDir, server: { port: fake.port } },
    middlewares: {
      use(route: string, handler: (req: unknown, res: FakeRes) => void) {
        mounts.push({ route, handler });
      },
    },
  };
  await (configure as (s: unknown) => unknown).call(plugin, server);
  const mounted = mounts[0];
  if (!mounted) throw new Error('configureServer mounted nothing');
  expect(mounted.route).toBe(DEV_STAMP_PATH);
  const res = new FakeRes();
  mounted.handler({}, res);
  return {
    status: res.statusCode,
    type: String(res.headers['content-type']),
    body: JSON.parse(res.body) as DevStamp,
  };
}

describe('vite.config.ts — the dev stamp (W-I D-I3)', () => {
  it('is serve-only: never part of a production build', async () => {
    const cfg = await loadViteConfig({}, 'build');
    const plugin = flatPlugins(cfg).find((p) => p.name === 'cairn-dev-stamp');
    expect(plugin?.apply).toBe('serve');
  });

  it('and Vite AGREES: the RESOLVED build plugin set has no stamp, and nothing defines its path (MINOR 7)', async () => {
    // The pin above reads the declared literal off the user config;
    // loadConfigFromFile does no filtering. This one asks Vite to resolve the
    // config the way `vite build` does and checks what actually survives.
    for (const k of ENV_KEYS) delete process.env[k];
    const built = await resolveConfig({ configFile: CONFIG, root: ROOT }, 'build');
    expect(built.plugins.map((p) => p.name)).not.toContain('cairn-dev-stamp');
    expect(JSON.stringify(built.define ?? {})).not.toMatch(/__cairn|CAIRN_DEV|dev-stamp/);
    // …and it IS there under serve, so the pin above is not vacuous.
    const served = await resolveConfig({ configFile: CONFIG, root: ROOT }, 'serve');
    expect(served.plugins.map((p) => p.name)).toContain('cairn-dev-stamp');
  });

  it('answers with THIS tree, the role, the seed flag, the launcher nonce and the cache dir', async () => {
    const cfg = await loadViteConfig({
      VITE_BROWSER_SHIM: '1',
      VITE_SEED_DEMO: '1',
      CAIRN_DEV_NONCE: 'run-42',
    });
    const { status, type, body } = await askStamp(cfg, {
      root: ROOT,
      cacheDir: cfg.cacheDir!,
      port: 1422,
    });
    expect(status).toBe(200);
    expect(type).toBe('application/json');
    expect(body.root).toBe(ROOT);
    expect(body.role).toBe('seed');
    expect(body.seed).toBe(true);
    expect(body.port).toBe(1422);
    expect(body.nonce).toBe('run-42');
    expect(body.pid).toBe(process.pid);
    expect(body.cacheDir).toBe(devCacheDirFor(ROOT, 'seed'));
    expect(body.shim).toBe(true);
    expect(body.head === null || /^[0-9a-f]{40}$/.test(body.head)).toBe(true);
  });

  it('names the SHIM flag too: a server without VITE_BROWSER_SHIM says so (identity refuses it)', async () => {
    const cfg = await loadViteConfig({ CAIRN_DEV_ROLE: 'seed', VITE_SEED_DEMO: '1' });
    const { body } = await askStamp(cfg, { root: ROOT, cacheDir: cfg.cacheDir! });
    expect(body.shim).toBe(false);
    expect(body.seed).toBe(true);
    expect(body.role).toBe('seed');
  });

  it('a hand-started server carries no nonce (null), and the fresh role reports seed=false', async () => {
    const cfg = await loadViteConfig({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh' });
    const { body } = await askStamp(cfg, { root: ROOT, cacheDir: cfg.cacheDir! });
    expect(body.nonce).toBeNull();
    expect(body.seed).toBe(false);
    expect(body.shim).toBe(true);
    expect(body.role).toBe('fresh');
    expect(body.port).toBeNull();
  });
});
