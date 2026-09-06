// @vitest-environment node
import path from 'node:path';
import { loadConfigFromFile, type Plugin, type UserConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEV_STAMP_PATH,
  devCacheDirFor,
  type DevRole,
  type DevStamp,
} from '../../scripts/dev-servers';

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(ROOT, 'vite.config.ts');
const ENV_KEYS = ['VITE_BROWSER_SHIM', 'VITE_SEED_DEMO', 'CAIRN_DEV_ROLE', 'CAIRN_DEV_NONCE'] as const;
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

  it('the shim port rule is unchanged (1421 shim, 1420 tauri; the seed/fresh scripts pass --port)', async () => {
    expect((await loadViteConfig({})).server?.port).toBe(1420);
    expect((await loadViteConfig({ VITE_BROWSER_SHIM: '1' })).server?.port).toBe(1421);
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
    expect(body.head === null || /^[0-9a-f]{40}$/.test(body.head)).toBe(true);
  });

  it('a hand-started server carries no nonce (null), and the fresh role reports seed=false', async () => {
    const cfg = await loadViteConfig({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh' });
    const { body } = await askStamp(cfg, { root: ROOT, cacheDir: cfg.cacheDir! });
    expect(body.nonce).toBeNull();
    expect(body.seed).toBe(false);
    expect(body.role).toBe('fresh');
    expect(body.port).toBeNull();
  });
});
