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
  const m0010 = (await import('./migrations/0010_seed_merchant_mappings.sql?raw')).default;
  const m0011 = (await import('./migrations/0011_seed_payment_categories.sql?raw')).default;
  const m0012 = (await import('./migrations/0012_add_transaction_person.sql?raw')).default;
  const m0013 = (await import('./migrations/0013_add_category_budget.sql?raw')).default;
  const m0014 = (await import('./migrations/0014_add_app_settings.sql?raw')).default;
  const m0015 = (await import('./migrations/0015_add_accent_colors.sql?raw')).default;
  const m0016 = (await import('./migrations/0016_add_ticker_sector_industry.sql?raw')).default;
  const m0017 = (await import('./migrations/0017_disclosure_foundations.sql?raw')).default;
  const m0018 = (await import('./migrations/0018_roadmap_rule_engine.sql?raw')).default;
  const m0019 = (await import('./migrations/0019_scenarios.sql?raw')).default;
  const m0020 = (await import('./migrations/0020_whatif_defaults.sql?raw')).default;
  const m0021 = (await import('./migrations/0021_fund_sectors.sql?raw')).default;
  const m0022 = (await import('./migrations/0022_fi_pills_position.sql?raw')).default;
  const m0023 = (await import('./migrations/0023_projection_detail_level.sql?raw')).default;
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
    { version: '0010_seed_merchant_mappings', sql: m0010 },
    { version: '0011_seed_payment_categories', sql: m0011 },
    { version: '0012_add_transaction_person', sql: m0012 },
    { version: '0013_add_category_budget', sql: m0013 },
    { version: '0014_add_app_settings', sql: m0014 },
    { version: '0015_add_accent_colors', sql: m0015 },
    { version: '0016_add_ticker_sector_industry', sql: m0016 },
    { version: '0017_disclosure_foundations', sql: m0017 },
    { version: '0018_roadmap_rule_engine', sql: m0018 },
    { version: '0019_scenarios', sql: m0019 },
    { version: '0020_whatif_defaults', sql: m0020 },
    { version: '0021_fund_sectors', sql: m0021 },
    { version: '0022_fi_pills_position', sql: m0022 },
    { version: '0023_projection_detail_level', sql: m0023 },
  ];
}
