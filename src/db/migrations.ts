import type { Database } from './db';

export interface Migration {
  version: string;
  sql: string;
}

// Detects whether a migration self-manages its transaction state via its
// own `BEGIN [TRANSACTION|IMMEDIATE|DEFERRED|EXCLUSIVE]`. These migrations
// (e.g. 0033, which toggles `PRAGMA foreign_keys` outside a tx) must run
// outside the runner-level BEGIN/COMMIT wrap, because:
//   1. SQLite silently ignores `PRAGMA foreign_keys` inside an open
//      transaction — wrapping 0033 in an outer BEGIN would no-op its
//      FK-disable step and the rebuild's DROP would fail.
//   2. SQLite forbids nested BEGINs — the inner BEGIN throws.
// The check runs against the un-stripped SQL so comments containing the
// word "BEGIN" don't trigger false positives (the comment stripper runs
// after this check).
const SELF_MANAGED_TX_RE = /\bBEGIN\s+(TRANSACTION|IMMEDIATE|DEFERRED|EXCLUSIVE)?\b/i;

function hasSelfManagedTransaction(sql: string): boolean {
  // Strip comments first so a "-- BEGIN TRANSACTION ..." comment doesn't
  // false-positive into the self-managed bucket.
  const stripped = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return SELF_MANAGED_TX_RE.test(stripped);
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

    // Atomicity wrap: each migration runs in a BEGIN/COMMIT envelope so a
    // mid-migration failure rolls back the partial work rather than leaving
    // the DB in a half-applied state with no schema_migrations row (which
    // the next boot would re-attempt and fail on the now-existing CREATE
    // TABLE). Wave-3 backend review (2026-05-27) flagged the absence as a
    // foot-gun first demonstrated by migration 0033's table rebuild.
    //
    // Migrations that contain their own BEGIN/COMMIT — currently 0033, which
    // needs to toggle PRAGMA foreign_keys outside any transaction — are
    // detected and left to self-manage. SQLite forbids nested BEGINs and
    // silently ignores `PRAGMA foreign_keys` inside an active transaction,
    // so wrapping them would break both paths.
    const selfManaged = hasSelfManagedTransaction(m.sql);

    if (selfManaged) {
      for (const stmt of statements) {
        await db.execute(stmt);
      }
      // Record outside any transaction since the migration's COMMIT already
      // fired by the time we get here. OR IGNORE so 0001-style self-recording
      // migrations don't conflict.
      await db.execute(
        'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)',
        [m.version],
      );
    } else {
      await db.execute('BEGIN');
      try {
        for (const stmt of statements) {
          await db.execute(stmt);
        }
        // Audit row goes INSIDE the wrap so it rolls back if the body fails —
        // that's the invariant that prevents the "half-applied with no
        // schema_migrations row, retried next boot, fails on existing CREATE
        // TABLE" foot-gun. OR IGNORE so 0001-style self-recording migrations
        // don't conflict.
        await db.execute(
          'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)',
          [m.version],
        );
        await db.execute('COMMIT');
      } catch (e) {
        // ROLLBACK can itself fail if the inner error already aborted the tx
        // (SQLite "cannot rollback - no transaction is active"). Swallow that
        // specific noise so the caller sees the real, original error.
        try {
          await db.execute('ROLLBACK');
        } catch {
          // ignore: rollback may have happened automatically on the inner error
        }
        throw e;
      }
    }
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
  const m0024 = (await import('./migrations/0024_cash_apy.sql?raw')).default;
  const m0025 = (await import('./migrations/0025_compounding_frequency.sql?raw')).default;
  const m0026 = (await import('./migrations/0026_asset_value_snapshots.sql?raw')).default;
  const m0027 = (await import('./migrations/0027_equity_grant_company_valuation.sql?raw')).default;
  const m0028 = (await import('./migrations/0028_utility_category_config.sql?raw')).default;
  const m0029 = (await import('./migrations/0029_auto_invest_salary_surplus.sql?raw')).default;
  const m0030 = (await import('./migrations/0030_enable_foreign_keys_and_orphan_cleanup.sql?raw')).default;
  const m0031 = (await import('./migrations/0031_real_2026_tax_data.sql?raw')).default;
  const m0032 = (await import('./migrations/0032_ltcg_brackets_2026.sql?raw')).default;
  const m0033 = (await import('./migrations/0033_fix_disclosure_acceptance_fk_actions.sql?raw')).default;
  const m0034 = (await import('./migrations/0034_add_query_indexes.sql?raw')).default;
  const m0035 = (await import('./migrations/0035_add_default_drawdown_tax_rate.sql?raw')).default;
  const m0036 = (await import('./migrations/0036_add_rent_lease_tracking.sql?raw')).default;
  // NB: 0037 is intentionally skipped — it's reserved for the planned
  // `0037_learning_state.sql` trivia migration (see docs/superpowers/specs/
  // 2026-05-28-v1.1-plan.md). These three claim 0038-0040 to avoid colliding
  // with it. The runner tracks each version independently, so the 0037 gap is
  // harmless and the trivia migration will still apply cleanly once added.
  const m0038 = (await import('./migrations/0038_seed_modern_etfs.sql?raw')).default;
  const m0039 = (await import('./migrations/0039_default_daily_refresh.sql?raw')).default;
  const m0040 = (await import('./migrations/0040_clear_synthetic_snapshots.sql?raw')).default;
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
    { version: '0024_cash_apy', sql: m0024 },
    { version: '0025_compounding_frequency', sql: m0025 },
    { version: '0026_asset_value_snapshots', sql: m0026 },
    { version: '0027_equity_grant_company_valuation', sql: m0027 },
    { version: '0028_utility_category_config', sql: m0028 },
    { version: '0029_auto_invest_salary_surplus', sql: m0029 },
    { version: '0030_enable_foreign_keys_and_orphan_cleanup', sql: m0030 },
    { version: '0031_real_2026_tax_data', sql: m0031 },
    { version: '0032_ltcg_brackets_2026', sql: m0032 },
    { version: '0033_fix_disclosure_acceptance_fk_actions', sql: m0033 },
    { version: '0034_add_query_indexes', sql: m0034 },
    { version: '0035_add_default_drawdown_tax_rate', sql: m0035 },
    { version: '0036_add_rent_lease_tracking', sql: m0036 },
    { version: '0038_seed_modern_etfs', sql: m0038 },
    { version: '0039_default_daily_refresh', sql: m0039 },
    { version: '0040_clear_synthetic_snapshots', sql: m0040 },
  ];
}
