import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devPortsFromEnv, type DevPortEnv, type DevRole } from '../scripts/dev-servers';

/** The tree Playwright was launched from — THE expected identity of both servers (D-I3). */
export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface E2eServer {
  name: 'seeded' | 'fresh';
  role: DevRole;
  port: number;
  url: string;
  seed: boolean;
  /** Both e2e projects serve the browser-shim app (VITE_BROWSER_SHIM=1); identity enforces it. */
  shim: boolean;
  script: 'dev:browser:seed' | 'dev:browser:fresh';
}

export interface E2eServers {
  seeded: E2eServer;
  fresh: E2eServer;
  all: readonly E2eServer[];
}

/**
 * v1.7.1 A-6: the two servers for a given env. E2E_PORT_BASE unset → the fixed
 * 1422 / 1423 (D-I12); set → base / base + 1. Pure over `env`, so the tests pin
 * the literals on `e2eServersFor({})` whatever the developer's shell exports.
 */
export function e2eServersFor(env: DevPortEnv): E2eServers {
  const ports = devPortsFromEnv(env);
  /** Project [seeded]: disclosures accepted, demo data present. */
  const seeded: E2eServer = {
    name: 'seeded',
    role: 'seed',
    port: ports.seed,
    url: `http://localhost:${ports.seed}`,
    seed: true,
    shim: true,
    script: 'dev:browser:seed',
  };
  /** Project [onboarding]: a FRESH (unseeded) IndexedDB so boot lands on the disclaimer + setup path (T26, D-WF16). */
  const fresh: E2eServer = {
    name: 'fresh',
    role: 'fresh',
    port: ports.fresh,
    url: `http://localhost:${ports.fresh}`,
    seed: false,
    shim: true,
    script: 'dev:browser:fresh',
  };
  return { seeded, fresh, all: [seeded, fresh] };
}

// This run's servers. Playwright evaluates playwright.config.ts in the main
// process and again in every worker with the inherited env, and spawns each
// webServer command with `{ ...process.env, ...env }` — so the base the config
// derived these URLs from is the base vite.config.ts computes the port from.
const THIS_RUN = e2eServersFor(process.env);
export const SEEDED_SERVER: E2eServer = THIS_RUN.seeded;
export const FRESH_SERVER: E2eServer = THIS_RUN.fresh;
export const E2E_SERVERS: readonly E2eServer[] = THIS_RUN.all;
