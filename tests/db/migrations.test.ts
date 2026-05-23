import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
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
    {
      version: '0005_add_employment_and_bonus_columns',
      sql: readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8'),
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
      '0005_add_employment_and_bonus_columns',
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
      '0005_add_employment_and_bonus_columns',
    ]);
  });
});

it('0008 adds property_id and vehicle_id columns to transactions', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>("PRAGMA table_info(transactions)");
  const names = cols.map((c) => c.name);
  expect(names).toContain('property_id');
  expect(names).toContain('vehicle_id');
  await db.close();
});

it('0009 seeds the base category tree with a resolvable parent tree (44 total after 0011)', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const rows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
  expect(rows[0].n).toBe(44);
  const orphans = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM categories c WHERE c.parent_category_id IS NOT NULL ' +
      'AND NOT EXISTS (SELECT 1 FROM categories p WHERE p.id = c.parent_category_id)',
  );
  expect(orphans[0].n).toBe(0);
  await db.close();
});

it('0010 seeds >=200 merchant mappings, all pointing at real categories', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const rows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM merchant_seed_mapping');
  expect(rows[0].n).toBeGreaterThanOrEqual(200);
  const bad = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM merchant_seed_mapping m ' +
      'WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = m.category_id)',
  );
  expect(bad[0].n).toBe(0);
  await db.close();
});

it('0011 adds Debt Payment and Business Expense categories and seeds payment patterns', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());

  // (i) categories 43 and 44 exist with correct types
  const debtCat = await db.select<{ id: number; name: string; type: string }>(
    "SELECT id, name, type FROM categories WHERE id = 43"
  );
  expect(debtCat).toHaveLength(1);
  expect(debtCat[0].name).toBe('Debt Payment');
  expect(debtCat[0].type).toBe('TRANSFER');

  const bizCat = await db.select<{ id: number; name: string; type: string }>(
    "SELECT id, name, type FROM categories WHERE id = 44"
  );
  expect(bizCat).toHaveLength(1);
  expect(bizCat[0].name).toBe('Business Expense');
  expect(bizCat[0].type).toBe('WANT');

  // (ii) CC-payment pattern AUTOPAY resolves to Transfer (category 41)
  const autopay = await db.select<{ category_id: number }>(
    "SELECT category_id FROM merchant_seed_mapping WHERE merchant_pattern = 'AUTOPAY'"
  );
  expect(autopay).toHaveLength(1);
  expect(autopay[0].category_id).toBe(41);

  // (iii) loan-servicer pattern NELNET resolves to Debt Payment (category 43)
  const nelnet = await db.select<{ category_id: number }>(
    "SELECT category_id FROM merchant_seed_mapping WHERE merchant_pattern = 'NELNET'"
  );
  expect(nelnet).toHaveLength(1);
  expect(nelnet[0].category_id).toBe(43);

  await db.close();
});

it('0012 adds a person_id column to transactions', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>('PRAGMA table_info(transactions)');
  expect(cols.map((c) => c.name)).toContain('person_id');
  await db.close();
});

it('0013 adds a monthly_budget column to categories', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>('PRAGMA table_info(categories)');
  expect(cols.map((c) => c.name)).toContain('monthly_budget');
  await db.close();
});

it('0014 creates the app_settings singleton with one seeded row', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>('PRAGMA table_info(app_settings)');
  const names = cols.map((c) => c.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'id', 'sidebar_layout', 'notifications_enabled', 'notification_day',
      'refresh_cadence', 'last_refresh_at', 'statements_folder_path',
    ]),
  );
  const rows = await db.select<{ id: number; notifications_enabled: number; refresh_cadence: string }>(
    'SELECT id, notifications_enabled, refresh_cadence FROM app_settings',
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(1);
  expect(rows[0].notifications_enabled).toBe(1);
  expect(rows[0].refresh_cadence).toBe('EVERY_LAUNCH');
  await db.close();
});
