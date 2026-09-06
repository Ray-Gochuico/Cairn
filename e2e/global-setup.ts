import type { FullConfig } from '@playwright/test';
import { assertServerIdentity, fetchDevStamp } from './identity';
import { E2E_ROOT, E2E_SERVERS } from './servers';

/**
 * W-I D-I5: runs in the main process AFTER Playwright has started (or, with
 * PW_REUSE_SERVER=1, attached to) both dev servers and BEFORE any test.
 * Asserts each server is THIS tree's, of the expected role, and launched by
 * this run — one clear error instead of twenty wrong-tree passes.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const reuse = process.env.PW_REUSE_SERVER === '1';
  const nonce = process.env.CAIRN_DEV_NONCE ?? null;
  if (!reuse && nonce === null) {
    throw new Error('[e2e/identity] playwright.config.ts minted no CAIRN_DEV_NONCE — the launcher check cannot run.');
  }
  for (const s of E2E_SERVERS) {
    const stamp = await fetchDevStamp(s.url);
    assertServerIdentity(stamp, {
      root: E2E_ROOT,
      nonce: reuse ? null : nonce,
      seed: s.seed,
      port: s.port,
      label: s.name,
    });
    console.log(
      `[e2e/identity] ${s.name} ${s.url} → ${stamp.root} (role ${stamp.role}, head ${stamp.head?.slice(0, 8) ?? 'n/a'}, pid ${stamp.pid}${reuse ? ', attached' : ''})`,
    );
  }
}
