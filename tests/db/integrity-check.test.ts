import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import {
  assertDatabaseIntegrity,
  DatabaseCorruptError,
} from '@/db/integrity';

describe('assertDatabaseIntegrity (M1)', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('passes for a healthy database', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    await expect(assertDatabaseIntegrity(db)).resolves.toBeUndefined();
  });

  it('throws DatabaseCorruptError when quick_check does not return ok', async () => {
    // Stub a db whose quick_check reports a problem. We don't try to physically
    // corrupt a file here (flaky across SQLite builds); we assert the detection
    // logic reacts to a non-"ok" quick_check result.
    const corrupt = {
      // Only the methods assertDatabaseIntegrity touches.
      select: async (sql: string) => {
        if (/quick_check/i.test(sql)) {
          return [{ quick_check: '*** in database main ***\nPage 4 is never used' }];
        }
        return [];
      },
    } as unknown as Parameters<typeof assertDatabaseIntegrity>[0];

    await expect(assertDatabaseIntegrity(corrupt)).rejects.toBeInstanceOf(
      DatabaseCorruptError,
    );
  });

  it('the DatabaseCorruptError message is user-facing (mentions corruption + backups)', async () => {
    const corrupt = {
      select: async (sql: string) => {
        if (/quick_check/i.test(sql)) return [{ quick_check: 'row 1 missing from index' }];
        return [];
      },
    } as unknown as Parameters<typeof assertDatabaseIntegrity>[0];

    try {
      await assertDatabaseIntegrity(corrupt);
      throw new Error('expected assertDatabaseIntegrity to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseCorruptError);
      expect((e as Error).message).toMatch(/corrupt/i);
      expect((e as Error).message).toMatch(/backup/i);
    }
  });

  it('rejects a genuine MULTI-ROW quick_check result (each row a problem)', async () => {
    // When corrupt, SQLite returns ONE row PER problem (never an "ok" row).
    // Build a real two-row result and assert row[0] (a problem line) is
    // detected as corruption.
    const corrupt = {
      select: async (sql: string) => {
        if (/quick_check/i.test(sql)) {
          return [
            { quick_check: 'row 3 missing from index idx_accounts' },
            { quick_check: 'wrong # of entries in index idx_tx' },
          ];
        }
        return [];
      },
    } as unknown as Parameters<typeof assertDatabaseIntegrity>[0];

    await expect(assertDatabaseIntegrity(corrupt)).rejects.toBeInstanceOf(
      DatabaseCorruptError,
    );
  });

  it('passes for the healthy single "ok" row (the success shape)', async () => {
    // SQLite returns exactly one row, value "ok", when the file is sound.
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    await expect(assertDatabaseIntegrity(db)).resolves.toBeUndefined();
  });
});
