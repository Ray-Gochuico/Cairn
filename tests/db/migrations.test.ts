import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { readFileSync, readdirSync } from 'node:fs';
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
  // 0014 seeds EVERY_LAUNCH, but the full chain runs 0039 which flips the
  // app-wide default to DAILY. This test runs all migrations, so DAILY wins.
  expect(rows[0].refresh_cadence).toBe('DAILY');
  await db.close();
});

it('0020 adds default_inflation + default_return_rate to app_settings (nullable)', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>("PRAGMA table_info(app_settings)");
  const names = cols.map((c) => c.name);
  expect(names).toContain('default_inflation');
  expect(names).toContain('default_return_rate');
  const seed = await db.select<{ default_inflation: number | null; default_return_rate: number | null }>(
    'SELECT default_inflation, default_return_rate FROM app_settings WHERE id = 1',
  );
  expect(seed).toHaveLength(1);
  expect(seed[0].default_inflation).toBeNull();
  expect(seed[0].default_return_rate).toBeNull();
  await db.close();
});

describe('0022 adds default_fi_pills_position to app_settings', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });
  afterEach(async () => {
    await db.close();
  });

  it('adds the default_fi_pills_position column with default "above"', async () => {
    const cols = await db.select<{ name: string }>("PRAGMA table_info(app_settings)");
    expect(cols.map((c) => c.name)).toContain('default_fi_pills_position');
    const rows = await db.select<{ default_fi_pills_position: string }>(
      'SELECT default_fi_pills_position FROM app_settings WHERE id = 1',
    );
    expect(rows[0]?.default_fi_pills_position).toBe('above');
  });

  it('CHECK constraint rejects values other than "above" or "below"', async () => {
    await expect(
      db.execute("UPDATE app_settings SET default_fi_pills_position = 'sideways' WHERE id = 1"),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('is idempotent — running loadAllMigrations again does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});

it('0015 adds accent_color columns to accounts and tickers, accepting NULL and hex', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());

  const accountCols = await db.select<{ name: string }>('PRAGMA table_info(accounts)');
  expect(accountCols.map((c) => c.name)).toContain('accent_color');
  const tickerCols = await db.select<{ name: string }>('PRAGMA table_info(tickers)');
  expect(tickerCols.map((c) => c.name)).toContain('accent_color');

  // A fresh account row has accent_color NULL by default.
  await db.execute(
    `INSERT INTO accounts (
      household_id, owner_person_id, beneficiary_dependent_id, name, institution,
      type, crypto_wallet_address, auto_fetch_enabled, excluded_from_net_worth, state_of_plan
    ) VALUES (1, NULL, NULL, 'Acct', NULL, 'ACCOUNT_BROKERAGE', NULL, 0, 0, NULL)`,
  );
  const a = await db.select<{ accent_color: string | null }>(
    'SELECT accent_color FROM accounts',
  );
  expect(a[0].accent_color).toBeNull();

  // Both columns accept a hex string.
  await db.execute('UPDATE accounts SET accent_color = ? WHERE id = 1', ['#4c78a8']);
  await db.execute(
    `INSERT INTO tickers (ticker, name, asset_class, leverage_factor, direction, user_added, accent_color)
     VALUES ('ZZZ', 'Test', 'OTHER', 1, 'LONG', 0, '#f58518')`,
  );
  const a2 = await db.select<{ accent_color: string }>('SELECT accent_color FROM accounts');
  expect(a2[0].accent_color).toBe('#4c78a8');
  const t = await db.select<{ accent_color: string }>(
    "SELECT accent_color FROM tickers WHERE ticker = 'ZZZ'",
  );
  expect(t[0].accent_color).toBe('#f58518');

  await db.close();
});

describe('0023_projection_detail_level migration', () => {
  it('adds default_projection_detail_level column with default tax_bucket', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const rows = await db.select<{ default_projection_detail_level: string }>(
      'SELECT default_projection_detail_level FROM app_settings WHERE id = 1',
    );
    expect(rows[0].default_projection_detail_level).toBe('tax_bucket');
    await db.close();
  });

  it('rejects an invalid value for default_projection_detail_level', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    await expect(
      db.execute(
        "UPDATE app_settings SET default_projection_detail_level = 'bogus' WHERE id = 1",
      ),
    ).rejects.toThrow();
    await db.close();
  });
});

describe('0024_cash_apy migration', () => {
  it('adds apy_rate column to accounts (nullable)', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const cols = await db.select<{ name: string }>('PRAGMA table_info(accounts)');
    expect(cols.map((c) => c.name)).toContain('apy_rate');

    // Verify that the column is nullable by inserting a row with NULL.
    await db.execute(
      `INSERT INTO accounts (
        household_id, owner_person_id, beneficiary_dependent_id, name, institution,
        type, crypto_wallet_address, auto_fetch_enabled, excluded_from_net_worth,
        allow_margin, state_of_plan
      ) VALUES (1, NULL, NULL, 'HYSA', NULL, 'ACCOUNT_SAVINGS', NULL, 0, 0, 0, NULL)`,
    );
    const rows = await db.select<{ apy_rate: number | null }>('SELECT apy_rate FROM accounts');
    expect(rows[0].apy_rate).toBeNull();
    await db.close();
  });

  it('adds default_cash_apy column to app_settings (nullable)', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const cols = await db.select<{ name: string }>('PRAGMA table_info(app_settings)');
    expect(cols.map((c) => c.name)).toContain('default_cash_apy');
    const seed = await db.select<{ default_cash_apy: number | null }>(
      'SELECT default_cash_apy FROM app_settings WHERE id = 1',
    );
    expect(seed[0].default_cash_apy).toBeNull();
    await db.close();
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
    await db.close();
  });
});

it('0042 adds investments_card_layout to app_settings (nullable, seeded null)', async () => {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, await loadAllMigrations());
  const cols = await db.select<{ name: string }>("PRAGMA table_info(app_settings)");
  expect(cols.map((c) => c.name)).toContain('investments_card_layout');
  const seed = await db.select<{ investments_card_layout: string | null }>(
    'SELECT investments_card_layout FROM app_settings WHERE id = 1',
  );
  expect(seed).toHaveLength(1);
  expect(seed[0].investments_card_layout).toBeNull();
  await db.close();
});

describe('0037_learning_state migration', () => {
  it('creates the learning_state singleton with one seeded row', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const cols = await db.select<{ name: string }>('PRAGMA table_info(learning_state)');
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id', 'difficulty_preference', 'last_shown_question_id',
        'last_shown_iso_date', 'streak_count', 'last_answered_iso_date',
      ]),
    );
    const rows = await db.select<{ id: number; difficulty_preference: string; streak_count: number }>(
      'SELECT id, difficulty_preference, streak_count FROM learning_state',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].difficulty_preference).toBe('Beginner');
    expect(rows[0].streak_count).toBe(0);
    await db.close();
  });

  it('rejects an invalid difficulty_preference via CHECK', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    await expect(
      db.execute("UPDATE learning_state SET difficulty_preference = 'Expert' WHERE id = 1"),
    ).rejects.toThrow(/CHECK constraint failed/i);
    await db.close();
  });

  it('creates learning_answers with a version-aware UNIQUE(question_id, question_version)', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    // First answer of v1.
    await db.execute(
      `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
       VALUES ('beg-apr', '2026-05-28', 0, 1, 1)`,
    );
    // Re-answering the SAME version is one-shot — the composite UNIQUE rejects it.
    await expect(
      db.execute(
        `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
         VALUES ('beg-apr', '2026-05-29', 1, 0, 1)`,
      ),
    ).rejects.toThrow(/UNIQUE/i);
    // After a content correction bumps the version, the SAME question_id at the
    // NEW version is answerable again — this is the v1.2 re-prompt the grain exists for.
    await expect(
      db.execute(
        `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
         VALUES ('beg-apr', '2026-06-01', 2, 1, 2)`,
      ),
    ).resolves.not.toThrow();
    const rows = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM learning_answers WHERE question_id = 'beg-apr'",
    );
    expect(rows[0].n).toBe(2); // v1 + v2 = two rows for the one question id
    await db.close();
  });

  it('adds NO disclosure columns to household (gate is normalized — MF-1)', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const cols = await db.select<{ name: string }>('PRAGMA table_info(household)');
    const names = cols.map((c) => c.name);
    // The learning gate reads disclosure_acceptances, not a household column.
    expect(names).not.toContain('learning_disclaimer_accepted_at');
    expect(names).not.toContain('learning_disclaimer_version_accepted');
    await db.close();
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
    await db.close();
  });
});

describe('0043 retires the legacy household disclosure columns', () => {
  it('drops all four disclosure cache columns from household', async () => {
    const db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    const cols = await db.select<{ name: string }>('PRAGMA table_info(household)');
    const names = cols.map((c) => c.name);
    expect(names).not.toContain('disclaimer_accepted_at');
    expect(names).not.toContain('disclaimer_version_accepted');
    expect(names).not.toContain('roadmap_disclaimer_accepted_at');
    expect(names).not.toContain('roadmap_disclaimer_version_accepted');
    // disclosure_acceptances (the single source of truth) still exists.
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='disclosure_acceptances'",
    );
    expect(tables).toHaveLength(1);
    await db.close();
  });

  // T6: prove the REAL installed-user path — apply the historical chain
  // (which created the columns in 0017), THEN append 0037 + 0043. This is
  // distinct from the other 0037/0043 tests that use a single fresh
  // loadAllMigrations() pass; it catches a drop that only works on a
  // freshly-built schema but not on an upgraded one.
  it('upgrade path: historical chain then 0037 + 0043 drops the columns cleanly', async () => {
    const db = new SqliteAdapter(':memory:');
    const all = await loadAllMigrations();
    // The historical chain as an existing v1.0-era install would have it:
    // every migration EXCEPT the two this feature adds.
    const historical = all.filter(
      (m) => m.version !== '0037_learning_state' && m.version !== '0043_drop_household_disclosure_columns',
    );
    await runMigrations(db, historical);
    // Columns exist on the upgraded-from schema (added in 0017).
    let cols = await db.select<{ name: string }>('PRAGMA table_info(household)');
    expect(cols.map((c) => c.name)).toContain('disclaimer_version_accepted');
    // Now apply the feature's new migrations on top, in order.
    await runMigrations(db, [
      all.find((m) => m.version === '0037_learning_state')!,
      all.find((m) => m.version === '0043_drop_household_disclosure_columns')!,
    ]);
    cols = await db.select<{ name: string }>('PRAGMA table_info(household)');
    const names = cols.map((c) => c.name);
    expect(names).toContain('id'); // sanity: household table intact after the drops
    expect(names).not.toContain('disclaimer_version_accepted');
    expect(names).not.toContain('roadmap_disclaimer_version_accepted');
    await db.close();
  });
});

describe('migration registry completeness (guardrail)', () => {
  // The directory of raw .sql migration files, relative to this test.
  const MIGRATIONS_DIR = resolve(__dirname, '../../src/db/migrations');
  // A migration filename is NNNN_snake_name.sql; the registered "version"
  // is that name WITHOUT the .sql extension (see loadAllMigrations()).
  const SQL_FILE_RE = /^(\d{4}_.+)\.sql$/;

  function versionsOnDisk(): string[] {
    return readdirSync(MIGRATIONS_DIR)
      .map((f) => SQL_FILE_RE.exec(f)?.[1])
      .filter((v): v is string => v != null)
      .sort();
  }

  it('every .sql file on disk matches the NNNN_name.sql convention', () => {
    // Catches a stray file (e.g. a 3-digit prefix, or a .sql.bak) that the
    // version-extraction regex would silently drop and thus hide from the
    // 1:1 check below.
    const stray = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith('.sql') && !SQL_FILE_RE.test(f),
    );
    expect(stray, `non-conforming .sql filenames: ${stray.join(', ')}`).toEqual([]);
  });

  it('loadAllMigrations() registers exactly the .sql files on disk (no orphans, no phantoms)', async () => {
    const disk = versionsOnDisk();
    const registered = (await loadAllMigrations()).map((m) => m.version).sort();

    // Orphan files: a .sql on disk that the loader forgot to register —
    // the silent-skip bug this guardrail exists to catch.
    const orphans = disk.filter((v) => !registered.includes(v));
    // Phantom entries: a version in the loader with no backing .sql file
    // (e.g. a renamed/deleted file the import list still references).
    const phantoms = registered.filter((v) => !disk.includes(v));

    expect(orphans, `unregistered migration files: ${orphans.join(', ')}`).toEqual([]);
    expect(phantoms, `registered versions with no .sql file: ${phantoms.join(', ')}`).toEqual([]);
    // Exact-set equality as the single load-bearing assertion.
    expect(registered).toEqual(disk);
  });

  it('registered versions are unique (no duplicate array entries)', async () => {
    const registered = (await loadAllMigrations()).map((m) => m.version);
    const unique = [...new Set(registered)];
    expect(registered).toEqual(
      expect.arrayContaining(unique),
    );
    expect(registered).toHaveLength(unique.length);
  });
});
