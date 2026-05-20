import type { Database } from './db';

export interface Migration {
  version: string;
  sql: string;
}

export async function runMigrations(db: Database, migrations: Migration[]): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = await db.select<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  const appliedSet = new Set(applied.map((a) => a.version));

  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;

    // Strip line-level SQL comments (-- ...) before splitting, then split on
    // statement-terminating semicolons and drop empty fragments.
    const stripped = m.sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');

    const statements = stripped
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await db.execute(stmt);
    }

    // Record successful application. OR IGNORE so that migrations which self-record
    // (e.g., 0001_initial.sql) don't conflict here.
    await db.execute(
      'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)',
      [m.version],
    );
  }
}

export async function loadAllMigrations(): Promise<Migration[]> {
  const m0001 = (await import('./migrations/0001_initial.sql?raw')).default;
  const m0002 = (await import('./migrations/0002_seed_tax_rules.sql?raw')).default;
  const m0003 = (await import('./migrations/0003_add_commission_columns.sql?raw')).default;
  const m0004 = (await import('./migrations/0004_seed_yonkers.sql?raw')).default;
  const m0005 = (await import('./migrations/0005_add_employment_and_bonus_columns.sql?raw')).default;
  const m0006 = (await import('./migrations/0006_seed_tickers.sql?raw')).default;
  const m0007 = (await import('./migrations/0007_add_account_margin.sql?raw')).default;
  const m0008 = (await import('./migrations/0008_add_transaction_property_links.sql?raw')).default;
  const m0009 = (await import('./migrations/0009_seed_categories.sql?raw')).default;
  return [
    { version: '0001_initial', sql: m0001 },
    { version: '0002_seed_tax_rules', sql: m0002 },
    { version: '0003_add_commission_columns', sql: m0003 },
    { version: '0004_seed_yonkers', sql: m0004 },
    { version: '0005_add_employment_and_bonus_columns', sql: m0005 },
    { version: '0006_seed_tickers', sql: m0006 },
    { version: '0007_add_account_margin', sql: m0007 },
    { version: '0008_add_transaction_property_links', sql: m0008 },
    { version: '0009_seed_categories', sql: m0009 },
  ];
}
