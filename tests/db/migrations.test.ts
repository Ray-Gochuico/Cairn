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

function loadAll() {
  return [
    {
      version: '0001_initial',
      sql: readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8'),
    },
    {
      version: '0002_seed_tax_rules',
      sql: readFileSync(resolve(__dirname, '../../src/db/migrations/0002_seed_tax_rules.sql'), 'utf-8'),
    },
    {
      version: '0003_add_commission_columns',
      sql: readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8'),
    },
    {
      version: '0004_seed_yonkers',
      sql: readFileSync(resolve(__dirname, '../../src/db/migrations/0004_seed_yonkers.sql'), 'utf-8'),
    },
  ];
}

describe('runMigrations idempotency', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('records every applied migration in schema_migrations', async () => {
    await runMigrations(db, loadAll());
    const rows = await db.select<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual([
      '0001_initial',
      '0002_seed_tax_rules',
      '0003_add_commission_columns',
      '0004_seed_yonkers',
    ]);
  });

  it('runs cleanly when called twice on the same DB (no errors, no duplicate rows)', async () => {
    await runMigrations(db, loadAll());
    const taxCountFirst = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM tax_rules');
    // Second run — should be a no-op
    await expect(runMigrations(db, loadAll())).resolves.not.toThrow();
    const taxCountSecond = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM tax_rules');
    expect(taxCountSecond[0].n).toBe(taxCountFirst[0].n);
  });

  it('recovers a DB where 0002 ran but was never recorded (simulates the prod bug)', async () => {
    const all = loadAll();
    // Apply 0001 — it self-records and the runner also records it
    await runMigrations(db, [all[0]]);
    // Manually run 0002 statements without recording (simulate pre-fix bug)
    const stripped0002 = all[1].sql
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    const stmts0002 = stripped0002
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of stmts0002) {
      await db.execute(stmt);
    }
    // schema_migrations has only 0001
    let rows = await db.select<{ version: string }>('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toEqual(['0001_initial']);
    // Now run the full migration list with the FIXED runner — should not error
    await expect(runMigrations(db, all)).resolves.not.toThrow();
    rows = await db.select<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual([
      '0001_initial',
      '0002_seed_tax_rules',
      '0003_add_commission_columns',
      '0004_seed_yonkers',
    ]);
  });
});
