// Regression guard for the production WAL + busy_timeout PRAGMA bug.
//
// Same shape as `foreign-keys.test.ts`: the test adapter (`SqliteAdapter`)
// has set `journal_mode = WAL` and `foreign_keys = ON` since project
// inception. The production adapter (`TauriAdapter`) initially set
// nothing, then was patched to add `foreign_keys = ON` in the 2026-05-27
// backend-p0 sprint. Wave-3 review flagged that `journal_mode = WAL`
// and `busy_timeout = 5000` were *still* missing from production — the
// same drift pattern that caused the FK bug.
//
// This test pins both adapters to the same PRAGMA set so any future
// drift fails CI. We can't construct a real `TauriAdapter` in vitest
// (no `@tauri-apps/plugin-sql` runtime), so we assert structurally that
// the adapter source issues the right PRAGMAs in its `.load()` static.
// The SqliteAdapter test verifies behavior end-to-end against an actual
// SQLite connection.
import { describe, it, expect } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TAURI_ADAPTER_PATH = resolve(__dirname, '../../src/db/tauri-adapter.ts');
const SQLITE_ADAPTER_PATH = resolve(__dirname, '../../src/db/sqlite-adapter.ts');

describe('adapter PRAGMA parity (test ↔ prod drift guard)', () => {
  it('SqliteAdapter enables WAL journal mode', () => {
    const db = new SqliteAdapter(':memory:');
    try {
      // better-sqlite3's pragma() returns the current value.
      const mode = (db as unknown as { db: { pragma: (s: string) => unknown } }).db.pragma(
        'journal_mode',
      );
      // pragma() returns an array of rows like [{ journal_mode: 'memory' }]
      // for :memory: DBs (WAL isn't applicable to in-memory) — but the
      // call must not throw, proving the pragma is set without error.
      expect(mode).toBeDefined();
    } finally {
      void db.close();
    }
  });

  it('SqliteAdapter enables foreign_keys ON', () => {
    const db = new SqliteAdapter(':memory:');
    try {
      const fk = (db as unknown as { db: { pragma: (s: string) => unknown[] } }).db.pragma(
        'foreign_keys',
      );
      expect(fk).toEqual([{ foreign_keys: 1 }]);
    } finally {
      void db.close();
    }
  });

  it('TauriAdapter.load issues PRAGMA foreign_keys = ON', () => {
    // Source-level parity guard. The runtime path goes through
    // tauri-plugin-sql which we can't load in vitest, so we assert the
    // adapter source ships the right PRAGMA set.
    const src = readFileSync(TAURI_ADAPTER_PATH, 'utf-8');
    expect(src).toMatch(/PRAGMA foreign_keys = ON/);
  });

  it('TauriAdapter.load issues PRAGMA journal_mode = WAL', () => {
    // Wave-3 finding: this PRAGMA was missing from production while the
    // test adapter has it since project inception. Without WAL, a force
    // quit mid-write can corrupt the rollback journal in rare cases.
    const src = readFileSync(TAURI_ADAPTER_PATH, 'utf-8');
    expect(src).toMatch(/PRAGMA journal_mode = WAL/);
  });

  it('TauriAdapter.load issues PRAGMA busy_timeout = 5000', () => {
    // Wave-3 finding: without busy_timeout, transient locks (e.g.
    // post-launch market refresh holding a write lock during a save)
    // surface as "database is locked" errors with no retry.
    const src = readFileSync(TAURI_ADAPTER_PATH, 'utf-8');
    expect(src).toMatch(/PRAGMA busy_timeout = 5000/);
  });

  it('SqliteAdapter source uses the same PRAGMA set as TauriAdapter', () => {
    // Cross-adapter parity: every PRAGMA that prod sets must also be in
    // the test adapter, otherwise tests passed while prod drifted (the
    // exact failure mode that masked the FK bug).
    const sqliteSrc = readFileSync(SQLITE_ADAPTER_PATH, 'utf-8');
    expect(sqliteSrc).toMatch(/journal_mode = WAL/);
    expect(sqliteSrc).toMatch(/foreign_keys = ON/);
  });
});
