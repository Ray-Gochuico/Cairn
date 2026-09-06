import { realpathSync } from 'node:fs';
import { DEV_STAMP_PATH, type DevStamp } from '../scripts/dev-servers';

export interface ExpectedIdentity {
  /** The tree Playwright runs from (E2E_ROOT). ALWAYS enforced. */
  root: string;
  /** This run's nonce; null waives the launcher check (PW_REUSE_SERVER=1). */
  nonce: string | null;
  seed: boolean;
  port: number;
  label: string;
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(a) === real(b);
}

/**
 * W-I D-I3/D-I4: throws (S5–S7) unless `stamp` describes a server of THIS
 * tree, of the expected role, launched by this run (unless waived).
 */
export function assertServerIdentity(stamp: DevStamp, expected: ExpectedIdentity): void {
  if (!samePath(stamp.root, expected.root)) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server belongs to a DIFFERENT tree.\n` +
        `  server root: ${stamp.root}\n` +
        `  this tree:   ${expected.root}\n` +
        `Stop that tree's dev server on port ${expected.port} (lsof -nP -iTCP:${expected.port}) or run its suite from its own directory.`,
    );
  }
  if (expected.nonce !== null && stamp.nonce !== expected.nonce) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server was not launched by this Playwright run (nonce ${stamp.nonce ?? 'none'} ≠ ${expected.nonce}). ` +
        `To attach to a server you started yourself from this tree, set PW_REUSE_SERVER=1.`,
    );
  }
  if (stamp.seed !== expected.seed) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server reports seed=${stamp.seed}; this project expects seed=${expected.seed} (server role ${stamp.role}).`,
    );
  }
}

/**
 * GET the stamp. A Vite server from a tree WITHOUT the plugin does not 404 —
 * its SPA fallback answers 200 text/html — so the content type is the check.
 */
export async function fetchDevStamp(baseURL: string): Promise<DevStamp> {
  const url = `${baseURL}${DEV_STAMP_PATH}`;
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('application/json')) {
    throw new Error(
      `[e2e/identity] ${url} answered ${res.status} ${type || '(no content type)'} — the server on this port is not a Cairn dev server built from a tree that carries the dev-stamp plugin. Stop it before re-running.`,
    );
  }
  return (await res.json()) as DevStamp;
}
