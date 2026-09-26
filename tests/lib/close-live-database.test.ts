import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// v1.7.1 U4 (CR-U4-3/CR-U4-4): closeLiveDatabase is the one direct invoke of
// the plugin close in src — the Settings restore (U1) and the macOS updater
// (Settings → Updates) both drain the live pool through it (the adapter's
// Database.close() reaches the same command through the plugin package, so
// the pin below counts the literal). Same Tauri mocks as
// tests/lib/db-backup.test.ts.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { closeLiveDatabase } from '@/lib/backup-restore';
import { collectSourceFiles, stripComments } from '../policy/source-walker';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const ROOT = path.resolve(__dirname, '..', '..');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('closeLiveDatabase (v1.7.1 U4 — the one direct plugin close)', () => {
  it('invokes the plugin close for the live database exactly once and resolves', async () => {
    mockInvoke.mockResolvedValue(true);
    await expect(closeLiveDatabase()).resolves.toBeUndefined();
    expect(mockInvoke.mock.calls).toEqual([['plugin:sql|close', { db: 'sqlite:finance.db' }]]);
  });

  it('propagates a rejection unchanged — it tolerates nothing itself, not even the not-loaded message', async () => {
    mockInvoke.mockRejectedValue('database sqlite:finance.db not loaded');
    await expect(closeLiveDatabase()).rejects.toBe('database sqlite:finance.db not loaded');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('src holds exactly one literal plugin:sql|close, and it is the body of closeLiveDatabase', async () => {
    const hits: Array<[string, number]> = [];
    for (const file of await collectSourceFiles(path.join(ROOT, 'src'))) {
      const n = stripComments(readFileSync(file, 'utf8')).split('plugin:sql|close').length - 1;
      if (n > 0) hits.push([path.relative(ROOT, file).split(path.sep).join('/'), n]);
    }
    expect(hits).toEqual([['src/lib/backup-restore.ts', 1]]);
    const src = stripComments(readFileSync(path.join(ROOT, 'src/lib/backup-restore.ts'), 'utf8'));
    const body = /export async function closeLiveDatabase\(\): Promise<void> \{([\s\S]*?)\n\}/.exec(src);
    expect(body?.[1].trim()).toBe("await invoke('plugin:sql|close', { db: DB_URL });");
  });
});
