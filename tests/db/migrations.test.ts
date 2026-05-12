import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('runMigrations', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('applies all migrations in the migrations folder', async () => {
    const migrationSql = readFileSync(
      resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
      'utf-8'
    );
    await runMigrations(db, [{ version: '0001_initial', sql: migrationSql }]);

    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('household');
    expect(tableNames).toContain('persons');
    expect(tableNames).toContain('dependents');
    expect(tableNames).toContain('accounts');
    expect(tableNames).toContain('schema_migrations');
  });

  it('records applied migrations in schema_migrations', async () => {
    const migrationSql = readFileSync(
      resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
      'utf-8'
    );
    await runMigrations(db, [{ version: '0001_initial', sql: migrationSql }]);

    const applied = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations"
    );
    expect(applied.map((a) => a.version)).toContain('0001_initial');
  });

  it('is idempotent — running twice does not error', async () => {
    const migrationSql = readFileSync(
      resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
      'utf-8'
    );
    await runMigrations(db, [{ version: '0001_initial', sql: migrationSql }]);
    await runMigrations(db, [{ version: '0001_initial', sql: migrationSql }]);

    const applied = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations"
    );
    expect(applied.filter((a) => a.version === '0001_initial')).toHaveLength(1);
  });

  it('creates singleton household row', async () => {
    const migrationSql = readFileSync(
      resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
      'utf-8'
    );
    await runMigrations(db, [{ version: '0001_initial', sql: migrationSql }]);

    const rows = await db.select<{ id: number }>('SELECT id FROM household');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });
});
