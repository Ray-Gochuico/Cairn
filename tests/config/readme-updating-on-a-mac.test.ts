import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// v1.7.1 U4 (CR-U4-1): the README's "Updating on a Mac" line ends where the
// app ends — tauri-plugin-updater swaps the bundle on macOS and returns without
// relaunching, so the user quits and reopens. U1's "Your data and updates"
// paragraph beneath it is pinned by tests/config/readme-data-and-updates.test.ts.
const README = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const MAC =
  '**Updating on a Mac:** inside the app, go to **Settings → Updates → Check for updates**, then **Install update**. When the card says **Update installed**, quit Cairn (**Cmd+Q**) and open it again to finish — no need to repeat any of the steps above.';

describe('README — updating on a Mac (v1.7.1 U4)', () => {
  it('carries the quit-and-reopen paragraph byte-exact, once', () => {
    expect(README.split(MAC).length - 1).toBe(1);
  });

  it('no longer says the app installs the new version for you with nothing left to do', () => {
    expect(README).not.toMatch(/downloads and installs the new version for\s+you/);
  });

  it('sits in the Mac install section, above the Windows one', () => {
    const at = README.indexOf(MAC);
    // Bind both heads first: indexOf's -1 for a renamed head would make the
    // lower bound vacuous.
    const mac = README.indexOf('### Mac — after the download');
    const windows = README.indexOf('### Windows — after the download');
    expect(mac).toBeGreaterThanOrEqual(0);
    expect(windows).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(mac);
    expect(at).toBeLessThan(windows);
  });
});
