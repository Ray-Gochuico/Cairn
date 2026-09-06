// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_CACHE_FOLDER,
  DEV_ROLE_PORTS,
  DEV_STAMP_PATH,
  devCacheDirFor,
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
