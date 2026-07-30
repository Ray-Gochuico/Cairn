import { describe, it, expect, vi, afterEach } from 'vitest';

// backup-restore re-exports isTauriRuntime for its existing importers; its
// own module graph pulls real Tauri packages, so mock them at the boundary.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { isTauriRuntime } from '@/lib/tauri-runtime';
import { isTauriRuntime as reExported } from '@/lib/backup-restore';

describe('isTauriRuntime (src/lib/tauri-runtime.ts — Tauri-import-free)', () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('is false in a plain browser/jsdom window', () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it('is true when the Tauri runtime marker is present', () => {
    (window as any).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });

  it('is re-exported unchanged from backup-restore for existing importers', () => {
    expect(reExported).toBe(isTauriRuntime);
  });
});
