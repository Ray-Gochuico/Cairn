import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_ROLE_PORTS, type DevRole } from '../scripts/dev-servers';

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

/** Project [seeded]: disclosures accepted, demo data present. */
export const SEEDED_SERVER: E2eServer = {
  name: 'seeded',
  role: 'seed',
  port: DEV_ROLE_PORTS.seed,
  url: `http://localhost:${DEV_ROLE_PORTS.seed}`,
  seed: true,
  shim: true,
  script: 'dev:browser:seed',
};

/** Project [onboarding]: a FRESH (unseeded) IndexedDB so boot lands on the disclaimer + setup path (T26, D-WF16). */
export const FRESH_SERVER: E2eServer = {
  name: 'fresh',
  role: 'fresh',
  port: DEV_ROLE_PORTS.fresh,
  url: `http://localhost:${DEV_ROLE_PORTS.fresh}`,
  seed: false,
  shim: true,
  script: 'dev:browser:fresh',
};

export const E2E_SERVERS: readonly E2eServer[] = [SEEDED_SERVER, FRESH_SERVER];
