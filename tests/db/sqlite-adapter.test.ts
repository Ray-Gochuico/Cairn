import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';

describe('SqliteAdapter', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('executes CREATE TABLE statements', async () => {
    const result = await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    expect(result.rowsAffected).toBe(0);
  });

  it('inserts and retrieves rows', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    const insertResult = await db.execute('INSERT INTO t (name) VALUES (?)', ['Alice']);
    expect(insertResult.lastInsertId).toBe(1);
    expect(insertResult.rowsAffected).toBe(1);

    const rows = await db.select<{ id: number; name: string }>('SELECT * FROM t');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
  });

  it('updates rows', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO t (name) VALUES (?)', ['Alice']);
    const result = await db.execute('UPDATE t SET name = ? WHERE id = ?', ['Bob', 1]);
    expect(result.rowsAffected).toBe(1);
  });

  it('returns parameterized query results', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO t (name) VALUES (?), (?)', ['Alice', 'Bob']);
    const rows = await db.select<{ name: string }>('SELECT name FROM t WHERE id = ?', [2]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bob');
  });
});
