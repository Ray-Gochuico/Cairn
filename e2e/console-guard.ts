import type { Page } from '@playwright/test';

/**
 * Console-error collector. Hard smoke contract:
 *   - zero page crashes (pageerror),
 *   - zero console.error output on a clean boot — most specifically the
 *     "Maximum update depth exceeded" render-loop class (shared-store gate
 *     boot-loop gotcha) that only reproduces in a real browser.
 * KNOWN_NOISE is the escape hatch for environment-structural chatter; extend
 * it with a comment per entry, never wholesale.
 */
export const KNOWN_NOISE: RegExp[] = [
  // The browser shim has no Rust HTTP proxy, so the boot market refresh's
  // Yahoo chart fetches are CORS-blocked by the browser (Yahoo sends no
  // Access-Control-Allow-Origin — the very reason the desktop app routes
  // these through plugin-http/Rust; see src/market/yahoo-client.ts docs).
  // Structural to the shim environment, impossible in the packaged app;
  // the refresh degrades to store error state. Matched against
  // "<message> <resource url>" so the bare "Failed to load resource:
  // net::ERR_FAILED" lines for the same requests are covered WITHOUT a
  // broad ERR_FAILED allowance.
  /query[12]\.finance\.yahoo\.com/,
];

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Resource-load failures carry the URL in location, not in the text.
    const withUrl = `${text} ${msg.location().url ?? ''}`;
    if (KNOWN_NOISE.some((re) => re.test(withUrl))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}
