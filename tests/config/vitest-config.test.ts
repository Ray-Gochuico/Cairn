// @vitest-environment node
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it } from 'vitest';
import { DEV_CACHE_FOLDER } from '../../scripts/dev-servers';

const ROOT = path.resolve(__dirname, '..', '..');

describe('vitest.config.ts — the results cache lives under the TREE (v1.7.1 A-6; the W-I D-I13 chip)', () => {
  it('cacheDir is <tree>/.vite.local — Vitest appends vitest/<hash>/results.json under it; never node_modules/.vite, which every symlinked worktree shares', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      path.join(ROOT, 'vitest.config.ts'),
      ROOT,
    );
    if (!loaded) throw new Error('vitest.config.ts did not load');
    expect(loaded.config.cacheDir).toBe(path.resolve(ROOT, DEV_CACHE_FOLDER));
    expect(loaded.config.cacheDir).not.toContain('node_modules');
    // rides .gitignore's *.local rule (D-I1) — no ignore line of its own
    expect(DEV_CACHE_FOLDER.endsWith('.local')).toBe(true);
    // the deprecated test.cache.dir is NOT the mechanism (Vitest 4: "Use Vite's cacheDir instead")
    expect((loaded.config as { test?: { cache?: unknown } }).test?.cache).toBeUndefined();
  });
});
