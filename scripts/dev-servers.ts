/**
 * v1.7.0 W-I — ONE table for the dev servers. Imported by vite.config.ts,
 * playwright.config.ts and the e2e harness, so the roles, the ports, the
 * cache-dir rule and the dev-stamp path are never spelled twice.
 *
 * Pure: `node:path` only — no vite import, no fs, no process access (callers
 * pass the env they hold).
 */
import path from 'node:path';

export type DevRole = 'tauri' | 'browser' | 'seed' | 'fresh';

/** Fixed ports (D-I12). tauri.conf.json's devUrl pins 1420; the rest are the v1.6.0 values. */
export const DEV_ROLE_PORTS: Readonly<Record<DevRole, number>> = {
  tauri: 1420, // `npm run dev` / `tauri dev`
  browser: 1421, // `npm run dev:browser` (shim, no seed)
  seed: 1422, // `npm run dev:browser:seed` — Playwright project [seeded]
  fresh: 1423, // `npm run dev:browser:fresh` — Playwright project [onboarding]
};

/** GET this on a running dev server → a DevStamp JSON body (serve-only plugin, vite.config.ts). */
export const DEV_STAMP_PATH = '/__cairn/dev-stamp';

/**
 * D-I1: the per-tree cache folder. `*.local` is ignored by .gitignore:17, so
 * this folder needs no ignore line of its own — deliberate: main's .gitignore
 * is routinely dirty and a branch that edits it cannot fast-forward.
 */
export const DEV_CACHE_FOLDER = '.vite.local';

export interface DevEnv {
  CAIRN_DEV_ROLE?: string;
  VITE_SEED_DEMO?: string;
  VITE_BROWSER_SHIM?: string;
}

const ROLES: ReadonlySet<string> = new Set<DevRole>(['tauri', 'browser', 'seed', 'fresh']);

export function isDevRole(value: unknown): value is DevRole {
  return typeof value === 'string' && ROLES.has(value);
}

/** D-I2: explicit CAIRN_DEV_ROLE wins; else derived from the two VITE_ flags. A typo throws. */
export function devRoleFromEnv(env: DevEnv): DevRole {
  if (env.CAIRN_DEV_ROLE !== undefined) {
    if (!isDevRole(env.CAIRN_DEV_ROLE)) {
      throw new Error(
        `CAIRN_DEV_ROLE must be one of tauri | browser | seed | fresh (got "${env.CAIRN_DEV_ROLE}")`,
      );
    }
    return env.CAIRN_DEV_ROLE;
  }
  if (env.VITE_SEED_DEMO === '1') return 'seed';
  if (env.VITE_BROWSER_SHIM === '1') return 'browser';
  return 'tauri';
}

/**
 * D-I1/D-I2: `<root>/.vite.local/<role>`. Never under node_modules — a
 * symlinked node_modules is exactly what shared `node_modules/.vite/deps`
 * across worktrees in v1.6.0 (two pre-bundle hashes in one page, "Failed to
 * fetch dynamically imported module", two React copies → "Invalid hook call").
 */
export function devCacheDirFor(root: string, role: DevRole): string {
  return path.resolve(root, DEV_CACHE_FOLDER, role);
}

/** What a running dev server says about itself (D-I3). */
export interface DevStamp {
  /** Vite's resolved root — the tree. THE identity. */
  root: string;
  role: DevRole;
  port: number | null;
  seed: boolean;
  /** VITE_BROWSER_SHIM: the @tauri-apps/* imports are the browser shims, not the real plugins. */
  shim: boolean;
  /** CAIRN_DEV_NONCE of the launching process; null for a hand-started server. */
  nonce: string | null;
  pid: number;
  /** `git rev-parse HEAD` at server start; null when git is unavailable. Informational. */
  head: string | null;
  cacheDir: string;
}
