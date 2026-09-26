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

/** Fixed ports (D-I12). tauri.conf.json's devUrl pins 1420; the rest are the v1.6.0 values. E2E_PORT_BASE (v1.7.1 A-6) moves seed/fresh only — see devPortsFromEnv. */
export const DEV_ROLE_PORTS: Readonly<Record<DevRole, number>> = {
  tauri: 1420, // `npm run dev` / `tauri dev`
  browser: 1421, // `npm run dev:browser` (shim, no seed)
  seed: 1422, // `npm run dev:browser:seed` — Playwright project [seeded]
  fresh: 1423, // `npm run dev:browser:fresh` — Playwright project [onboarding]
};

/** The env as far as the ports are concerned (process.env satisfies it). */
export interface DevPortEnv {
  E2E_PORT_BASE?: string;
}

/** Ports an E2E_PORT_BASE pair may never land on: tauri.conf.json's devUrl and the hand-run shim. */
const IMMOVABLE_PORTS: ReadonlySet<number> = new Set([DEV_ROLE_PORTS.tauri, DEV_ROLE_PORTS.browser]);

/**
 * v1.7.1 I-(h2): the WHATWG Fetch "bad ports" (https://fetch.spec.whatwg.org/#bad-port)
 * from 1024 up — the only ones a base in 1024–65534 or its +1 can reach. Node's
 * fetch (global-setup's identity check) and Chromium (ERR_UNSAFE_PORT) refuse
 * them before connecting: base 1722 → fresh 1723 failed with undici's `bad port`.
 */
export const FETCH_BAD_PORTS: ReadonlySet<number> = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/**
 * v1.7.1 A-6 (CR-I-2): OPT-IN. Unset or empty → the fixed table, the very
 * same object (D-I12: 1420–1423, byte-identical). Set → seed = base and
 * fresh = base + 1; tauri and browser never move. Anything else THROWS: a
 * silent fallback to 1422/1423 here is two trees on the same port again —
 * the collision this knob exists to end (the devRoleFromEnv typo precedent).
 */
export function devPortsFromEnv(env: DevPortEnv): Readonly<Record<DevRole, number>> {
  const raw = env.E2E_PORT_BASE;
  if (raw === undefined || raw === '') return DEV_ROLE_PORTS;
  const base = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const usable =
    Number.isInteger(base) &&
    base >= 1024 &&
    base <= 65534 &&
    !IMMOVABLE_PORTS.has(base) &&
    !IMMOVABLE_PORTS.has(base + 1) &&
    !FETCH_BAD_PORTS.has(base) &&
    !FETCH_BAD_PORTS.has(base + 1);
  if (!usable) {
    throw new Error(
      `E2E_PORT_BASE must be an integer from 1024 to 65534, and neither it nor the port after it may be ${DEV_ROLE_PORTS.tauri} or ${DEV_ROLE_PORTS.browser} (got "${raw}"). ` +
        `Neither may be a WHATWG Fetch "bad port" either (browsers and Node's fetch refuse them): ${[...FETCH_BAD_PORTS].join(', ')}. ` +
        `It moves only the seed and fresh ports (seed = base, fresh = base + 1); unset it for the fixed ${DEV_ROLE_PORTS.seed}/${DEV_ROLE_PORTS.fresh}.`,
    );
  }
  return { ...DEV_ROLE_PORTS, seed: base, fresh: base + 1 };
}

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
