import type { BatchStatement, Database } from './db';

export interface Migration {
  version: string;
  sql: string;
}

/**
 * The highest schema version this build understands.
 *
 * DERIVATION: the COUNT of registered migrations (see `loadAllMigrations`).
 * Every migration adds exactly one forward step, so the count is a monotonic
 * schema-version number that bumps automatically when a migration is appended.
 * After the runner applies migrations it stamps this into `PRAGMA user_version`
 * (a SQLite integer that lives in the db file header), giving us a cheap,
 * file-local "what schema is this?" marker that survives a file copy/restore.
 *
 * PARITY: `src-tauri/src/db_backup.rs::MAX_SCHEMA_VERSION` MUST equal this — the
 * Rust restore guard refuses a backup whose stamped `user_version` exceeds it.
 * `tests/db/schema-version-guard.test.ts` asserts this equals the migration
 * count AND pins the literal so a one-sided bump fails a test.
 */
export const MAX_SCHEMA_VERSION = 49;

/**
 * Thrown by `runMigrations` when the database's stamped `user_version` is
 * GREATER than `MAX_SCHEMA_VERSION` — i.e. the file was created/upgraded by a
 * newer build of Cairn than the one now running. We refuse to run (older)
 * migrations against it because doing so could misinterpret newer columns or
 * silently corrupt data. `src/main.tsx` renders this as a friendly
 * "please update Cairn" screen rather than a raw stack trace.
 */
export class SchemaTooNewError extends Error {
  readonly foundVersion: number;
  readonly maxSupportedVersion: number;
  constructor(foundVersion: number, maxSupportedVersion: number) {
    super(
      `This database was created by a newer version of Cairn (schema ${foundVersion}; ` +
        `this app supports up to ${maxSupportedVersion}). Please update Cairn to the ` +
        `latest version, then reopen the app.`,
    );
    this.name = 'SchemaTooNewError';
    this.foundVersion = foundVersion;
    this.maxSupportedVersion = maxSupportedVersion;
    // Restore prototype chain across the TS-to-ES5 target boundary so
    // `instanceof SchemaTooNewError` holds.
    Object.setPrototypeOf(this, SchemaTooNewError.prototype);
  }
}

/**
 * Read the SQLite `user_version` (a header-stored integer, default 0). Returns
 * 0 for a brand-new database (no migrations run yet). Tolerates the handful of
 * column-name shapes adapters return for `PRAGMA user_version`.
 */
export async function readUserVersion(db: Database): Promise<number> {
  const rows = await db.select<Record<string, unknown>>('PRAGMA user_version');
  const row = rows[0];
  if (!row) return 0;
  const raw = row.user_version ?? Object.values(row)[0];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Detects whether a migration self-manages its transaction state via its
// own `BEGIN [TRANSACTION|IMMEDIATE|DEFERRED|EXCLUSIVE]`. These migrations
// (e.g. 0033, which toggles `PRAGMA foreign_keys` outside a tx) must run
// with `executeBatch({ transaction: false })` — i.e. on one connection but
// WITHOUT a runner-added BEGIN/COMMIT wrap — because:
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
  // DOWNGRADE GUARD (H3): before doing anything, refuse a database written by a
  // NEWER build. `user_version` is 0 on a fresh DB and on every pre-guard
  // install (we never stamped it before this release), so existing users are
  // unaffected — only a file that a future, higher-version build stamped can
  // exceed MAX_SCHEMA_VERSION. Running old migrations against a newer schema
  // could half-apply or misread columns, so we throw a typed error main.tsx
  // surfaces as a friendly "update Cairn" screen instead of proceeding blind.
  const currentVersion = await readUserVersion(db);
  if (currentVersion > MAX_SCHEMA_VERSION) {
    throw new SchemaTooNewError(currentVersion, MAX_SCHEMA_VERSION);
  }

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

    const statements: BatchStatement[] = stripped
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((sql) => ({ sql }));

    // The audit row records that this migration ran. OR IGNORE so 0001-style
    // self-recording migrations don't conflict.
    const auditStmt: BatchStatement = {
      sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)',
      params: [m.version],
    };

    // Atomicity, the right way: each migration runs through `executeBatch`,
    // which routes every statement to ONE physical connection.
    //
    // WHY THIS MATTERS (the pool bug): prod runs `@tauri-apps/plugin-sql` → a
    // sqlx connection POOL that hands out a DIFFERENT connection per
    // `execute()` call. The previous implementation expressed the atomicity
    // wrap as three separate execute() calls (`BEGIN`, body, `COMMIT`), which
    // the pool scattered across three connections — so in prod the wrap
    // protected NOTHING. A killed app-update mid-migration could half-apply
    // schema with no schema_migrations row, then re-run next boot and fail on
    // the now-existing CREATE TABLE. A single-connection test adapter was
    // structurally blind to this. `executeBatch` closes the gap: the whole
    // batch (body + audit row) commits or rolls back together on one
    // connection, in both prod and test.
    //
    // SELF-MANAGED migrations (currently 0033, which toggles PRAGMA
    // foreign_keys outside any tx and carries its own BEGIN/COMMIT) run with
    // `transaction: false`: one connection, but no runner-added wrap, so the
    // migration's own transaction/PRAGMA statements run exactly as written.
    // SQLite forbids nested BEGINs and ignores PRAGMA foreign_keys inside a
    // transaction, so wrapping them would break both. The audit row is
    // appended to the batch; 0033's COMMIT has fired by the time it runs, so
    // it lands outside any transaction, which is correct.
    const selfManaged = hasSelfManagedTransaction(m.sql);

    await db.executeBatch([...statements, auditStmt], { transaction: !selfManaged });
  }

  // STAMP the schema version into the db-file header so future boots (and a
  // restore's pre-flight) can tell what schema this file is. `PRAGMA
  // user_version = N` does not accept a bind parameter and N is a build-time
  // constant (never user input), so interpolation is safe here. Runs outside
  // executeBatch: it's a single idempotent header write, and on the self-managed
  // (0033) path the batch's own COMMIT has already fired.
  await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION}`);
}

/**
 * Registry of every migration: [version, lazy `?raw` loader]. ARRAY ORDER IS
 * APPLY ORDER. Each `?raw` import resolves to the migration's SQL text as a
 * plain string module with no side effects, which is what makes the
 * concurrent load in `loadAllMigrations` safe: nothing "registers" on
 * import, and Promise.all preserves input order, so the returned array is
 * identical to the old one-await-at-a-time implementation — just without 47
 * serialized round-trips on boot.
 *
 * Adding a migration: append a row here AND bump MAX_SCHEMA_VERSION.
 * tests/policy/migrations-policy.test.ts enforces registry↔disk parity and
 * the hand-curated-data ratchet; tests/db/migrations.test.ts pins the order.
 */
const MIGRATION_REGISTRY: ReadonlyArray<
  readonly [version: string, load: () => Promise<{ default: string }>]
> = [
  ['0001_initial', () => import('./migrations/0001_initial.sql?raw')],
  ['0002_seed_tax_rules', () => import('./migrations/0002_seed_tax_rules.sql?raw')],
  ['0003_add_commission_columns', () => import('./migrations/0003_add_commission_columns.sql?raw')],
  ['0004_seed_yonkers', () => import('./migrations/0004_seed_yonkers.sql?raw')],
  ['0005_add_employment_and_bonus_columns', () => import('./migrations/0005_add_employment_and_bonus_columns.sql?raw')],
  ['0006_seed_tickers', () => import('./migrations/0006_seed_tickers.sql?raw')],
  ['0007_add_account_margin', () => import('./migrations/0007_add_account_margin.sql?raw')],
  ['0008_add_transaction_property_links', () => import('./migrations/0008_add_transaction_property_links.sql?raw')],
  ['0009_seed_categories', () => import('./migrations/0009_seed_categories.sql?raw')],
  ['0010_seed_merchant_mappings', () => import('./migrations/0010_seed_merchant_mappings.sql?raw')],
  ['0011_seed_payment_categories', () => import('./migrations/0011_seed_payment_categories.sql?raw')],
  ['0012_add_transaction_person', () => import('./migrations/0012_add_transaction_person.sql?raw')],
  ['0013_add_category_budget', () => import('./migrations/0013_add_category_budget.sql?raw')],
  ['0014_add_app_settings', () => import('./migrations/0014_add_app_settings.sql?raw')],
  ['0015_add_accent_colors', () => import('./migrations/0015_add_accent_colors.sql?raw')],
  ['0016_add_ticker_sector_industry', () => import('./migrations/0016_add_ticker_sector_industry.sql?raw')],
  ['0017_disclosure_foundations', () => import('./migrations/0017_disclosure_foundations.sql?raw')],
  ['0018_roadmap_rule_engine', () => import('./migrations/0018_roadmap_rule_engine.sql?raw')],
  ['0019_scenarios', () => import('./migrations/0019_scenarios.sql?raw')],
  ['0020_whatif_defaults', () => import('./migrations/0020_whatif_defaults.sql?raw')],
  ['0021_fund_sectors', () => import('./migrations/0021_fund_sectors.sql?raw')],
  ['0022_fi_pills_position', () => import('./migrations/0022_fi_pills_position.sql?raw')],
  ['0023_projection_detail_level', () => import('./migrations/0023_projection_detail_level.sql?raw')],
  ['0024_cash_apy', () => import('./migrations/0024_cash_apy.sql?raw')],
  ['0025_compounding_frequency', () => import('./migrations/0025_compounding_frequency.sql?raw')],
  ['0026_asset_value_snapshots', () => import('./migrations/0026_asset_value_snapshots.sql?raw')],
  ['0027_equity_grant_company_valuation', () => import('./migrations/0027_equity_grant_company_valuation.sql?raw')],
  ['0028_utility_category_config', () => import('./migrations/0028_utility_category_config.sql?raw')],
  ['0029_auto_invest_salary_surplus', () => import('./migrations/0029_auto_invest_salary_surplus.sql?raw')],
  ['0030_enable_foreign_keys_and_orphan_cleanup', () => import('./migrations/0030_enable_foreign_keys_and_orphan_cleanup.sql?raw')],
  ['0031_real_2026_tax_data', () => import('./migrations/0031_real_2026_tax_data.sql?raw')],
  ['0032_ltcg_brackets_2026', () => import('./migrations/0032_ltcg_brackets_2026.sql?raw')],
  ['0033_fix_disclosure_acceptance_fk_actions', () => import('./migrations/0033_fix_disclosure_acceptance_fk_actions.sql?raw')],
  ['0034_add_query_indexes', () => import('./migrations/0034_add_query_indexes.sql?raw')],
  ['0035_add_default_drawdown_tax_rate', () => import('./migrations/0035_add_default_drawdown_tax_rate.sql?raw')],
  ['0036_add_rent_lease_tracking', () => import('./migrations/0036_add_rent_lease_tracking.sql?raw')],
  // 0037 is the trivia feature's reserved slot, now filled (v1.1, 2026-05-28).
  // See docs/superpowers/specs/2026-05-28-trivia-learning-spec.md. 0038-0040
  // were assigned ahead of it; the runner tracks each version independently so
  // the historical numbering is harmless.
  ['0037_learning_state', () => import('./migrations/0037_learning_state.sql?raw')],
  ['0038_seed_modern_etfs', () => import('./migrations/0038_seed_modern_etfs.sql?raw')],
  ['0039_default_daily_refresh', () => import('./migrations/0039_default_daily_refresh.sql?raw')],
  ['0040_clear_synthetic_snapshots', () => import('./migrations/0040_clear_synthetic_snapshots.sql?raw')],
  ['0041_fund_holding_names', () => import('./migrations/0041_fund_holding_names.sql?raw')],
  ['0042_investments_card_layout', () => import('./migrations/0042_investments_card_layout.sql?raw')],
  // 0043 retires the four legacy household disclosure cache columns added in
  // 0017; the disclosure gate now reads disclosure_acceptances exclusively
  // (single source of truth, MF-1/T5, v1.1 2026-05-28). DROP COLUMN — the only
  // destructive migration in the v1.x set; lands atomically with the code that
  // stops referencing those columns.
  ['0043_drop_household_disclosure_columns', () => import('./migrations/0043_drop_household_disclosure_columns.sql?raw')],
  // 0044 adds the equity grant-type discriminator (RSU/ISO/NSO) to
  // equity_grants. Additive ADD COLUMN NOT NULL DEFAULT 'RSU' + CHECK; existing
  // rows back-fill to 'RSU'. The CHECK ⇔ GrantType enum ⇔ Zod nativeEnum stay
  // in lock-step (Calculators Wave 1 — EquityValue rebuild).
  ['0044_equity_grant_type', () => import('./migrations/0044_equity_grant_type.sql?raw')],
  // 0045 adds household-level asset-class target allocations (class-led
  // hierarchy envelope) as a nullable JSON column on app_settings. Additive
  // ADD COLUMN; Σ targetPct ≤ 1 validated in SettingsRepo, not SQL.
  ['0045_asset_class_target_allocations', () => import('./migrations/0045_asset_class_target_allocations.sql?raw')],
  // 0046 adds last_seen_month to app_settings: tracks the YYYY-MM of the most
  // recent month for which the app surfaced the monthly-input ritual prompt.
  // Drives the once-per-month auto-route to /monthly (Wave 3). Peer to
  // last_refresh_at — app/UI state, not household financial data.
  ['0046_app_settings_last_seen_month', () => import('./migrations/0046_app_settings_last_seen_month.sql?raw')],
  // 0047 moves calculator-card visibility from the 'calculator-hidden-cards'
  // localStorage key into app_settings (single source of truth), mirroring the
  // investments_card_layout precedent (0042). Additive ADD COLUMN TEXT, seeded
  // NULL = all cards visible; a one-time importCalcVisibilityIfNeeded()
  // back-fills the old localStorage value then clears the key.
  ['0047_calculators_card_layout', () => import('./migrations/0047_calculators_card_layout.sql?raw')],
  // 0048 flips the learning_state difficulty preference to 'Mixed' — the
  // Learn v3 redesign's default (Wave 8). See the SQL header for why an
  // unconditional singleton UPDATE is correct.
  ['0048_learning_preference_default', () => import('./migrations/0048_learning_preference_default.sql?raw')],
  // 0049 dedupes AMORTIZATION loan_payments duplicates (Monthly-ritual
  // double-record corruption, Wave 9 M37) and adds a PARTIAL UNIQUE index on
  // (loan_id, payment_date) WHERE source='AMORTIZATION' — same-day
  // MANUAL/IMPORTED rows stay legal.
  ['0049_loan_payments_unique_amortization', () => import('./migrations/0049_loan_payments_unique_amortization.sql?raw')],
];

export async function loadAllMigrations(): Promise<Migration[]> {
  // Concurrent, order-preserving: Promise.all resolves in input order and
  // the imports are side-effect-free string modules (see registry doc).
  const modules = await Promise.all(MIGRATION_REGISTRY.map(([, load]) => load()));
  return MIGRATION_REGISTRY.map(([version], i) => ({ version, sql: modules[i].default }));
}
