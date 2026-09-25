import { realpathSync } from 'node:fs';
import { DEV_STAMP_PATH, type DevRole, type DevStamp } from '../scripts/dev-servers';

export interface ExpectedIdentity {
  /** The tree Playwright runs from (E2E_ROOT). ALWAYS enforced. */
  root: string;
  /** This run's nonce; null waives the launcher check (PW_REUSE_SERVER=1). */
  nonce: string | null;
  seed: boolean;
  /** The ROLE this project needs. It keys the dep cache, so the seed flag alone is not the role. */
  role: DevRole;
  /** The browser shim must be the thing answering — the real @tauri-apps modules cannot boot here. */
  shim: boolean;
  port: number;
  label: string;
}

/**
 * MINOR 3: compare TREES, not spellings. Vite's stamp root is
 * `normalizePath(cwd)` — forward slashes on every platform — while
 * `path.resolve` / `realpathSync` hand back the platform separator
 * (backslashes on Windows), so a Windows run would refuse its own server over
 * separators alone. Both sides go through realpath (following symlinks and, on
 * a case-insensitive filesystem, restoring the on-disk casing), are then
 * spelled with forward slashes, and lose a trailing separator.
 *
 * Case is deliberately NOT folded: on a case-sensitive filesystem two trees
 * that differ only in case ARE different trees, and where the filesystem does
 * not care realpath has already reconciled the casing. A root that does not
 * exist on this machine (the foreign-tree case) keeps its literal spelling,
 * which is what the refusal prints back.
 */
function normalizeTreePath(p: string): string {
  let out = p;
  try {
    out = realpathSync(p);
  } catch {
    // a foreign tree's root need not exist here — compare the spelling we were given
  }
  out = out.split('\\').join('/');
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out;
}

function samePath(a: string, b: string): boolean {
  return normalizeTreePath(a) === normalizeTreePath(b);
}

/**
 * W-I D-I3/D-I4: throws (S5–S7, and the port) unless `stamp` describes a server of THIS
 * tree, of the expected role and shim, launched by this run (unless waived).
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
  // MINOR 4: the ROLE, not only the seed flag. A hand-started
  // `CAIRN_DEV_ROLE=tauri VITE_SEED_DEMO=1 VITE_BROWSER_SHIM=1 vite --port 1422`
  // reports seed=true while optimizing its deps into .vite.local/tauri — the
  // very per-role isolation this wave built.
  if (stamp.role !== expected.role) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server reports role=${stamp.role}; this project expects role=${expected.role} (its dep cache is .vite.local/${stamp.role}, not .vite.local/${expected.role}).`,
    );
  }
  if (stamp.shim !== expected.shim) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server reports shim=${stamp.shim}; this project expects shim=${expected.shim} (the e2e projects run the browser-shim build; a server resolving the real @tauri-apps modules cannot boot here).`,
    );
  }
  // v1.7.1 A-6 (CR-I-4): the served port. The stamp was fetched FROM
  // expected.port, so a stamp naming another port means whatever answers here
  // was configured for a different one — a forwarder, or a server whose
  // E2E_PORT_BASE is not this run's. Last on purpose: the tree, launcher, role
  // and shim messages above keep their precedence.
  if (stamp.port !== expected.port) {
    throw new Error(
      `[e2e/identity] the ${expected.label} server reports port=${stamp.port ?? 'none'}; this project expects port=${expected.port} (E2E_PORT_BASE moves the seed and fresh ports together; a server configured for another port is answering here).`,
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
