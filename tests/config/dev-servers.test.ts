// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_CACHE_FOLDER,
  DEV_ROLE_PORTS,
  DEV_STAMP_PATH,
  FETCH_BAD_PORTS,
  devCacheDirFor,
  devPortsFromEnv,
  devRoleFromEnv,
} from '../../scripts/dev-servers';

const ROLES = ['tauri', 'browser', 'seed', 'fresh'] as const;

describe('dev-servers table (W-I D-I2)', () => {
  it('derives the role from the two VITE_ flags; an explicit CAIRN_DEV_ROLE wins', () => {
    expect(devRoleFromEnv({})).toBe('tauri');
    expect(devRoleFromEnv({ VITE_BROWSER_SHIM: '1' })).toBe('browser');
    expect(devRoleFromEnv({ VITE_BROWSER_SHIM: '1', VITE_SEED_DEMO: '1' })).toBe('seed');
    expect(devRoleFromEnv({ VITE_BROWSER_SHIM: '1', CAIRN_DEV_ROLE: 'fresh' })).toBe('fresh');
    expect(devRoleFromEnv({ VITE_SEED_DEMO: '1', CAIRN_DEV_ROLE: 'tauri' })).toBe('tauri');
  });

  it('a misspelled CAIRN_DEV_ROLE throws rather than silently sharing a cache', () => {
    expect(() => devRoleFromEnv({ CAIRN_DEV_ROLE: 'seeded' })).toThrow(/CAIRN_DEV_ROLE/);
  });

  it('every role owns a distinct fixed port (1420–1423, unchanged from v1.6.0)', () => {
    expect(DEV_ROLE_PORTS).toEqual({ tauri: 1420, browser: 1421, seed: 1422, fresh: 1423 });
  });

  it('every role owns a distinct cache dir under the TREE — never under node_modules (the symlink shares that)', () => {
    const dirs = ROLES.map((r) => devCacheDirFor('/tree', r));
    expect(new Set(dirs).size).toBe(ROLES.length);
    for (const d of dirs) {
      expect(d.startsWith(path.resolve('/tree', DEV_CACHE_FOLDER) + path.sep)).toBe(true);
      expect(d).not.toContain('node_modules');
    }
  });

  it('the cache folder rides the committed *.local ignore rule (D-I1: no .gitignore edit)', () => {
    expect(DEV_CACHE_FOLDER.endsWith('.local')).toBe(true);
  });

  it('the stamp path is dev-namespaced and absolute', () => {
    expect(DEV_STAMP_PATH).toBe('/__cairn/dev-stamp');
  });
});

describe('E2E_PORT_BASE (v1.7.1 A-6, CR-I-2) — an opt-in base for the two Playwright ports', () => {
  it('unset, or empty, → THE fixed table: the same object (D-I12, 1420–1423 byte-identical)', () => {
    expect(devPortsFromEnv({})).toBe(DEV_ROLE_PORTS);
    expect(devPortsFromEnv({ E2E_PORT_BASE: '' })).toBe(DEV_ROLE_PORTS);
    expect(devPortsFromEnv({})).toEqual({ tauri: 1420, browser: 1421, seed: 1422, fresh: 1423 });
  });

  it('set → seed = base, fresh = base + 1; tauri and browser never move', () => {
    expect(devPortsFromEnv({ E2E_PORT_BASE: '1522' })).toEqual({
      tauri: 1420,
      browser: 1421,
      seed: 1522,
      fresh: 1523,
    });
    expect(devPortsFromEnv({ E2E_PORT_BASE: '1422' })).toEqual(DEV_ROLE_PORTS);
    expect(devPortsFromEnv({ E2E_PORT_BASE: '65534' })).toMatchObject({ seed: 65534, fresh: 65535 });
  });

  it('anything that is not a usable base THROWS — never a silent fallback to 1422/1423 (a fallback is the silent collision this knob exists to end)', () => {
    // '1522\n' (a stray `echo` into an env file): JavaScript's `$` without the m flag
    // matches only at the very end of the input, so /^\d+$/ already refuses it — pinned.
    for (const bad of ['abc', '80', '1023', '65535', '1419', '1420', '1421', '1522.5', ' 1522', '1522\n', '+1522', '-1522', '0x5f2']) {
      expect(() => devPortsFromEnv({ E2E_PORT_BASE: bad }), bad).toThrow(
        /E2E_PORT_BASE must be an integer from 1024 to 65534/,
      );
    }
    expect(() => devPortsFromEnv({ E2E_PORT_BASE: '1419' })).toThrow(/1420 or 1421 \(got "1419"\)/);
  });

  it('the message keeps the calm register and names the fixed pair to fall back to by hand', () => {
    let message = '';
    try {
      devPortsFromEnv({ E2E_PORT_BASE: 'x' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/!/);
    expect(message).not.toMatch(/you should/i);
    expect(message).toContain('unset it for the fixed 1422/1423.');
  });
});

/* ── v1.7.1 I-(h2): a base whose seed or fresh port is a WHATWG Fetch "bad
      port" is refused too. Base 1722 → fresh 1723 failed in global-setup with
      undici's `bad port` (Chromium: ERR_UNSAFE_PORT), found by impl-v171-m1. ── */
describe('E2E_PORT_BASE (v1.7.1 I-(h2)) — never a WHATWG Fetch bad port for seed or fresh', () => {
  const BAD_FROM_1024 = [1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080];

  it('the list is the spec list from 1024 up, byte-exact and sorted', () => {
    expect([...FETCH_BAD_PORTS]).toEqual(BAD_FROM_1024);
  });

  it('a base that IS a bad port, or whose fresh port (base + 1) is one, throws (1722 → fresh 1723 is the M1 find)', () => {
    for (const bad of BAD_FROM_1024) {
      expect(() => devPortsFromEnv({ E2E_PORT_BASE: String(bad) }), `seed ${bad}`).toThrow(/WHATWG Fetch "bad port"/);
      expect(() => devPortsFromEnv({ E2E_PORT_BASE: String(bad - 1) }), `fresh ${bad}`).toThrow(/WHATWG Fetch "bad port"/);
    }
  });

  it('the train\'s lane bases and the neighbours of a bad pair still resolve (the rule is additive)', () => {
    for (const ok of [1522, 1622, 1822, 1922, 2022, 2122, 1721, 1724, 2050, 10081, 65534]) {
      expect(devPortsFromEnv({ E2E_PORT_BASE: String(ok) }), String(ok)).toEqual({ ...DEV_ROLE_PORTS, seed: ok, fresh: ok + 1 });
    }
    expect(devPortsFromEnv({})).toBe(DEV_ROLE_PORTS); // D-I12: unset is still the fixed table, the same object
  });

  it('CI-1 (extended): the ONE message names the bad-port rule and the list, and keeps every landed clause', () => {
    let message = '';
    try {
      devPortsFromEnv({ E2E_PORT_BASE: '1722' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      'E2E_PORT_BASE must be an integer from 1024 to 65534, and neither it nor the port after it may be 1420 or 1421 (got "1722"). ' +
        'Neither may be a WHATWG Fetch "bad port" either (browsers and Node\'s fetch refuse them): ' +
        '1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080. ' +
        'It moves only the seed and fresh ports (seed = base, fresh = base + 1); unset it for the fixed 1422/1423.',
    );
    expect(message).not.toMatch(/!/);
  });

  it('drift receipt: THIS Node\'s fetch refuses every listed port before any connection (cause "bad port")', async () => {
    for (const p of FETCH_BAD_PORTS) {
      const err = await fetch(`http://127.0.0.1:${p}/`).then(
        () => null,
        (e: unknown) => e as Error & { cause?: { message?: string } },
      );
      expect(err?.cause?.message, String(p)).toBe('bad port');
    }
  });

  it('drift receipt: the installed undici (the Fetch implementation jsdom ships) lists exactly these from 1024 up — a spec addition reds here', () => {
    const req = createRequire(path.join(__dirname, 'dev-servers.test.ts'));
    const { badPorts } = req('undici/lib/web/fetch/constants.js') as { badPorts: readonly string[] };
    expect(badPorts.map(Number).filter((p) => p >= 1024)).toEqual([...FETCH_BAD_PORTS]);
  });
});

const PKG = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the two Playwright scripts (v1.7.1 A-6) — the port is computed in vite.config.ts', () => {
  it('pass no --port; --strictPort and the explicit role stay (byte-exact)', () => {
    expect(PKG.scripts['dev:browser:seed']).toBe('VITE_BROWSER_SHIM=1 VITE_SEED_DEMO=1 CAIRN_DEV_ROLE=seed vite --strictPort');
    expect(PKG.scripts['dev:browser:fresh']).toBe('VITE_BROWSER_SHIM=1 CAIRN_DEV_ROLE=fresh vite --strictPort');
  });
});
