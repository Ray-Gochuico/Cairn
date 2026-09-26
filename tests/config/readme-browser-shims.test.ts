import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_ROLE_PORTS, FETCH_BAD_PORTS } from '../../scripts/dev-servers';

// v1.8.0 T12 (chip v171-12: P5 chip d; Lane I leftovers b and c). The shims
// README is where a developer reads the E2E_PORT_BASE rules, so it states the
// WHATWG bad-port refusal (P5, d6a396cd), preview_start's fixed ports and the
// dev servers' load-policy timeout, and every port it names agrees with
// scripts/dev-servers.ts and .claude/launch.json. Compared with whitespace
// collapsed, so a reflow of the Markdown is not a failure.
const ROOT = resolve(__dirname, '../..');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const README = flat(readFileSync(resolve(ROOT, 'src/lib/browser-shims/README.md'), 'utf8'));
const LAUNCH = JSON.parse(readFileSync(resolve(ROOT, '.claude/launch.json'), 'utf8')) as {
  configurations: Array<{ name: string; port: number }>;
};

const BAD_PORT_CLAUSE =
  'or one whose pair holds a WHATWG Fetch "bad port" (1719, 1720, 1723, 2049, …; the full list is `FETCH_BAD_PORTS` in `scripts/dev-servers.ts`) fails at once rather than falling back.';
const BAD_PORT_EXAMPLE =
  "Chromium and Node's fetch refuse a bad port before connecting, so base 1722 is refused for its fresh port 1723.";
const PREVIEW_NOTE =
  '`.claude/launch.json` declares the fixed ports (its `vite-browser-seed` entry waits on 1422), so unset `E2E_PORT_BASE` wherever `preview_start` runs: with a base exported, the seed server binds the base instead and the preview keeps waiting on 1422.';
const WEB_SERVER_NOTE =
  "Each dev server's cold start (`webServer[].timeout` in `playwright.config.ts`) follows the same policy: `webServerTimeoutFor()` (`e2e/boot-timeout.ts`) is twice the policy's test budget — 120 s under normal parallelism, 240 s serialized.";

describe('src/lib/browser-shims/README.md — the E2E_PORT_BASE rules agree with the code (v1.8.0 T12)', () => {
  it('states the WHATWG bad-port refusal and names the table it lives in (P5 chip d)', () => {
    expect(README.includes(BAD_PORT_CLAUSE), 'the README states the bad-port clause').toBe(true);
    expect(README.includes(BAD_PORT_EXAMPLE), 'the README states the bad-port example').toBe(true);
    expect(FETCH_BAD_PORTS.has(1723), "the example's fresh port 1723 is a bad port").toBe(true);
    expect(FETCH_BAD_PORTS.has(1722), "the example's base 1722 is not itself a bad port").toBe(false);
  });

  it('every port the clause cites as a bad port is in FETCH_BAD_PORTS', () => {
    const cited = (/\((\d[\d, ]*), …;/.exec(BAD_PORT_CLAUSE)?.[1] ?? '').split(', ').map(Number);
    expect(cited).toEqual([1719, 1720, 1723, 2049]);
    for (const p of cited) expect(FETCH_BAD_PORTS.has(p), String(p)).toBe(true);
  });

  it('says to unset E2E_PORT_BASE for preview_start, and launch.json waits on the fixed role ports it describes (Lane I leftover c)', () => {
    expect(README.includes(PREVIEW_NOTE), 'the README states the preview_start note').toBe(true);
    const port = (name: string) => LAUNCH.configurations.find((c) => c.name === name)?.port;
    expect(port('vite')).toBe(DEV_ROLE_PORTS.tauri);
    expect(port('vite-browser-shim')).toBe(DEV_ROLE_PORTS.browser);
    expect(port('vite-browser-seed')).toBe(DEV_ROLE_PORTS.seed);
  });

  it("states that the dev servers' cold start follows the load policy (Lane I leftover b)", () => {
    expect(README.includes(WEB_SERVER_NOTE), 'the README states the webServer timeout note').toBe(true);
  });
});
