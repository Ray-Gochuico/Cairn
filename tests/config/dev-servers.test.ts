// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_CACHE_FOLDER,
  DEV_ROLE_PORTS,
  DEV_STAMP_PATH,
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
