import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
const isTauriRuntime = vi.fn();
vi.mock('@/lib/tauri-runtime', () => ({
  isTauriRuntime: () => isTauriRuntime(),
}));

import { resetSampleDb } from '@/db/sample-reset';
import { EXPLORE_DB_URL } from '@/lib/explore-mode';

/** Minimal fake IndexedDB: records the key deleted from the shim store. */
function installFakeIdb() {
  const deleted: unknown[] = [];
  const store = { delete: (key: unknown) => void deleted.push(key) };
  const tx: {
    oncomplete: null | (() => void);
    onerror: null | (() => void);
    objectStore: () => typeof store;
  } = {
    oncomplete: null,
    onerror: null,
    objectStore: () => store,
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: vi.fn(),
  };
  const openReq: {
    result: typeof db;
    onupgradeneeded: null | (() => void);
    onsuccess: null | (() => void);
    onerror: null | (() => void);
    error: null;
  } = {
    result: db,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    error: null,
  };
  vi.stubGlobal('indexedDB', {
    open: (name: string, version: number) => {
      expect(name).toBe('finance-app-shim');
      expect(version).toBe(1);
      queueMicrotask(() => openReq.onsuccess?.());
      return openReq;
    },
  });
  return { deleted, dbClose: db.close };
}

describe('resetSampleDb', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('Tauri: invokes db_sample_reset with EXACTLY the sample URL', async () => {
    isTauriRuntime.mockReturnValue(true);
    invoke.mockResolvedValue(undefined);
    await resetSampleDb();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('db_sample_reset', {
      db: 'sqlite:sample-explore.db',
    });
  });

  it('browser shim: deletes the sample record key from the shim IDB (no invoke — the shim invoke stub throws)', async () => {
    isTauriRuntime.mockReturnValue(false);
    const { deleted, dbClose } = installFakeIdb();
    await resetSampleDb();
    expect(deleted).toEqual(['sample-explore.db']);
    expect(dbClose).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('URL derives from the shared constant (no second literal)', () => {
    expect(EXPLORE_DB_URL.replace(/^sqlite:/, '')).toBe('sample-explore.db');
  });
});
