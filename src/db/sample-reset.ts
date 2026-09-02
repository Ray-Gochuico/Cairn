import { invoke } from '@tauri-apps/api/core';
import { EXPLORE_DB_URL } from '@/lib/explore-mode';
import { isTauriRuntime } from '@/lib/tauri-runtime';
import {
  SHIM_IDB_NAME,
  SHIM_IDB_STORE,
  shimKeyForDbUrl,
} from '@/lib/browser-shims/shim-db-constants';

/**
 * Delete the throwaway sample DB (W4 D-S8) — idempotent; a no-op when absent.
 *
 * Tauri: the Rust `db_sample_reset` command (URL-allowlisted to
 * EXPLORE_DB_URL; drops the pool, deletes file + -wal + -shm).
 * Browser shim: delete the sample record from the shim's IndexedDB. The
 * branch is REQUIRED — the shim's invoke stub (browser-shims/api-core.ts)
 * warns-then-throws on unknown commands.
 */
export async function resetSampleDb(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('db_sample_reset', { db: EXPLORE_DB_URL });
    return;
  }
  await deleteSampleShimRecord();
}

function deleteSampleShimRecord(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(SHIM_IDB_NAME, 1);
    open.onupgradeneeded = () => {
      // First opener on a fresh profile: create the store the shim expects.
      if (!open.result.objectStoreNames.contains(SHIM_IDB_STORE)) {
        open.result.createObjectStore(SHIM_IDB_STORE);
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(SHIM_IDB_STORE, 'readwrite');
      tx.objectStore(SHIM_IDB_STORE).delete(shimKeyForDbUrl(EXPLORE_DB_URL));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
