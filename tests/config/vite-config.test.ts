// @vitest-environment node
import path from 'node:path';
import { loadConfigFromFile, type Plugin, type UserConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { devCacheDirFor, type DevRole } from '../../scripts/dev-servers';

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
