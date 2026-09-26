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
 * The runner stamps `PRAGMA user_version` (a SQLite integer that lives in the
 * db file header) inside each migration's own batch — that migration's
 * registry ordinal, v1.7.1 U3 — and a full run ends at this number, giving us
 * a cheap, file-local "what schema is this?" marker that survives a file
 * copy/restore.
 *
 * PARITY: `src-tauri/src/db_backup.rs::MAX_SCHEMA_VERSION` MUST equal this — the
 * Rust restore guard refuses a backup whose stamped `user_version` exceeds it.
 * `tests/db/schema-version-guard.test.ts` asserts this equals the migration
 * count AND pins the literal so a one-sided bump fails a test.
 */
export const MAX_SCHEMA_VERSION = 55;

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
 * Thrown by `src/db/init.ts` when `runMigrations` rejects on the real profile
 * (v1.7.1 U1). Name-matched by the boot-error screen; carries the cause and
 * the path of the pre-update copy taken this boot (null when none was —
 * "Continue without a copy", or a copy that was not needed). A
 * SchemaTooNewError is never wrapped: it is thrown before any migration runs.
 * `copyIsFromBeforeUpdate` is false when the named copy was taken of a file an
 * earlier attempt had already changed partway (no origin copy existed), so
 * the screen never calls it the data from before the update (U1-m9).
 * `chainOrigin` / `chainTarget` are the schema the file held before ANY
 * attempt of this update and the schema it is moving to (null when unknown),
 * so the screen labels THIS chain's partway copies honestly (CR-U-23a/24).
 */
export class MigrationFailedError extends Error {
  readonly cause: unknown;
  readonly preUpdateCopyPath: string | null;
  readonly copyIsFromBeforeUpdate: boolean;
  readonly chainOrigin: number | null;
  readonly chainTarget: number | null;
  constructor(
    cause: unknown,
    preUpdateCopyPath: string | null,
    copyIsFromBeforeUpdate = true,
    chainOrigin: number | null = null,
    chainTarget: number | null = null,
  ) {
    super(
      'Cairn could not finish updating your data: ' +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'MigrationFailedError';
    this.cause = cause;
    this.preUpdateCopyPath = preUpdateCopyPath;
    this.copyIsFromBeforeUpdate = copyIsFromBeforeUpdate;
    this.chainOrigin = chainOrigin;
    this.chainTarget = chainTarget;
    Object.setPrototypeOf(this, MigrationFailedError.prototype);
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

export interface PendingMigrations {
  /** Registry migrations already recorded in schema_migrations (0 when the table is absent). */
  applied: number;
  /** Registry migrations not yet recorded, in apply order. */
  pending: Migration[];
}

/**
 * READ-ONLY mirror of the runner's own "already applied" set (see
 * runMigrations: sqlite_master check → schema_migrations names). Used by
 * init.ts to decide whether to take the pre-update copy BEFORE runMigrations
 * runs (v1.7.1 U1, CR-U-5). Never creates the table, never stamps anything.
 * Keyed on names, not user_version: names are what the runner itself skips
 * on, and a file a pre-U3 runner touched carries the constant
 * MAX_SCHEMA_VERSION even after a subset. `applied` is the count of REGISTRY
 * versions present, so a foreign row (a chain marker, a newer build's name)
 * never inflates it and `applied + pending.length === migrations.length`.
 */
export async function pendingMigrations(
  db: Database,
  migrations: Migration[],
): Promise<PendingMigrations> {
  const tables = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  const appliedSet = new Set<string>();
  if ((tables[0]?.n ?? 0) > 0) {
    const rows = await db.select<{ version: string }>('SELECT version FROM schema_migrations');
    for (const r of rows) appliedSet.add(r.version);
  }
  const pending = migrations.filter((m) => !appliedSet.has(m.version));
  return { applied: migrations.length - pending.length, pending };
}

// Detects whether a migration self-manages its transaction state via its
// own `BEGIN`. These migrations (e.g. 0033, which toggles `PRAGMA
// foreign_keys` outside a tx) must run with `executeBatch({ transaction:
// false })` — i.e. on one connection but WITHOUT a runner-added BEGIN/COMMIT
// wrap — because:
//   1. SQLite silently ignores `PRAGMA foreign_keys` inside an open
//      transaction — wrapping 0033 in an outer BEGIN would no-op its
//      FK-disable step and the rebuild's DROP would fail.
//   2. SQLite forbids nested BEGINs — the inner BEGIN throws.
// v1.7.1 U3: the test is STATEMENT-INITIAL and runs on the runner's own
// comment-stripped statements (splitStatements): a statement that IS a
// `BEGIN`, `BEGIN DEFERRED|IMMEDIATE|EXCLUSIVE`, each optionally followed by
// `TRANSACTION` and, after it, a transaction name. A comment that mentions
// BEGIN, or a one-line `CREATE TRIGGER … BEGIN … END;` (one statement that
// merely contains the word), stays on the wrapped, atomic path. A trigger body
// spread over several lines is NOT supported: the splitter cuts it at the `;`
// that ends a body line, so the migration fails, inside the wrap, and rolls
// back whole. Keep a trigger on one line.
const SELF_MANAGED_TX_RE = /^BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION(?:\s+\w+)?)?$/i;

/**
 * The runner's statement list: line-level SQL comments (-- ...) stripped
 * before splitting, then split on statement-terminating semicolons at end of
 * line, empty fragments dropped.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * v1.7.1 U3: a registry migration's schema version is its 1-based position in
 * MIGRATION_REGISTRY (equal to its 4-digit prefix — pinned in
 * tests/policy/migrations-policy.test.ts). Undefined for any other name, so a
 * test's synthetic migration stamps nothing.
 */
function registryOrdinal(version: string): number | undefined {
  const i = MIGRATION_REGISTRY.findIndex(([v]) => v === version);
  return i === -1 ? undefined : i + 1;
}

/**
 * v1.7.1 U3 (U1 chip b): the in-progress marker of an UPDATE CHAIN — a
 * `schema_migrations` row `chain:<origin>-><target>` that the runner writes in
 * the SAME batch as the chain's first pending migration and deletes in the
 * batch of its last. Per-migration stamping makes a file an interrupted update
 * left partway read like a clean schema-k file (user_version === applied); the
 * marker keeps the schema the file held before ANY attempt of this update, so
 * the pre-update gate (src/db/init.ts) still resumes from the origin copy
 * (D-U1-17). It is never a registry key (keys are `NNNN_name`), and
 * pendingMigrations counts registry names only, so it never inflates `applied`.
 */
export interface ChainMarker {
  origin: number;
  target: number;
}
const CHAIN_MARKER_LIKE = 'chain:%';
const CHAIN_MARKER_RE = /^chain:(\d+)->(\d+)$/;

/** READ-ONLY: the chain marker, or null (no schema_migrations table, or no marker row). */
export async function readChainMarker(db: Database): Promise<ChainMarker | null> {
  const tables = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  if ((tables[0]?.n ?? 0) === 0) return null;
  const rows = await db.select<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version LIKE ?',
    [CHAIN_MARKER_LIKE],
  );
  for (const r of rows) {
    const m = CHAIN_MARKER_RE.exec(r.version);
    if (m) return { origin: Number(m[1]), target: Number(m[2]) };
  }
  return null;
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

  const pending = migrations.filter((m) => !appliedSet.has(m.version));
  // v1.7.1 U3: the schema this run ends at — the registry ordinal of the LAST
  // registry migration in the list passed (55 for the full chain, N for a
  // prefix). `origin` is how many of the list's migrations this file already
  // had: an UPDATE CHAIN (origin > 0, two or more pending) carries the marker.
  const lastOrdinal = [...migrations]
    .reverse()
    .map((m) => registryOrdinal(m.version))
    .find((o) => o !== undefined);
  const origin = migrations.length - pending.length;
  // Code review CR-U3-7: the schema the file held before ANY attempt of this
  // update. A file a pre-U3 runner left partway still shows it as
  // 0 < user_version < applied (that runner stamped only after a full chain);
  // this chain's first commit stamps that signal away, so the marker carries
  // it. Otherwise the origin is what the file already had.
  const markOrigin = currentVersion > 0 && currentVersion < origin ? currentVersion : origin;
  const existing = await readChainMarker(db);
  // A resumed chain keeps the marker it already has (its origin is the true
  // one); a marker for another target is stale and is replaced.
  const markChain =
    origin > 0 && pending.length > 1 && lastOrdinal !== undefined && existing?.target !== lastOrdinal;
  const clearMarkers: BatchStatement = {
    sql: 'DELETE FROM schema_migrations WHERE version LIKE ?',
    params: [CHAIN_MARKER_LIKE],
  };
  let stamp = currentVersion;

  for (const [i, m] of pending.entries()) {
    const statements: BatchStatement[] = splitStatements(m.sql).map((sql) => ({ sql }));

    // The audit row records that this migration ran. OR IGNORE so 0001-style
    // self-recording migrations don't conflict.
    const auditStmt: BatchStatement = {
      sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)',
      params: [m.version],
    };
    const batch: BatchStatement[] = [...statements, auditStmt];
    if (i === 0 && markChain) {
      batch.push(clearMarkers, {
        sql: 'INSERT INTO schema_migrations (version) VALUES (?)',
        params: [`chain:${markOrigin}->${lastOrdinal}`],
      });
    }
    if (i === pending.length - 1) batch.push(clearMarkers);

    // v1.7.1 U3: STAMP this migration's schema version INSIDE its own batch, so
    // the header write commits or rolls back with the migration (user_version
    // lives in page 1 of the file). A crash mid-chain therefore leaves the
    // number of the last migration that committed, and an older build's
    // downgrade guard refuses the file. Never lowers the stamp (a re-run gap
    // migration on a newer file keeps it). `PRAGMA user_version = N` takes no
    // bind parameter; N is a registry position, never user input.
    const ordinal = registryOrdinal(m.version);
    if (ordinal !== undefined) {
      stamp = Math.max(stamp, ordinal);
      batch.push({ sql: `PRAGMA user_version = ${stamp}` });
    }

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
    // batch (body + audit row + marker + stamp) commits or rolls back together
    // on one connection, in both prod and test.
    //
    // SELF-MANAGED migrations (currently 0033, which toggles PRAGMA
    // foreign_keys outside any tx and carries its own BEGIN/COMMIT) run with
    // `transaction: false`: one connection, but no runner-added wrap, so the
    // migration's own transaction/PRAGMA statements run exactly as written.
    // SQLite forbids nested BEGINs and ignores PRAGMA foreign_keys inside a
    // transaction, so wrapping them would break both. The audit row and the
    // stamp are appended to the batch; 0033's COMMIT has fired by the time they
    // run, so they land outside any transaction — acceptable for a migration
    // every released file already has (tests/db/upgrade-path.test.ts pins how
    // "recorded" and "applied" disagree for it).
    const selfManaged = statements.some((s) => SELF_MANAGED_TX_RE.test(s.sql));

    await db.executeBatch(batch, { transaction: !selfManaged });
  }

  // TRAILING STAMP: the schema this run ends at, so future boots (and a
  // restore's pre-flight) can tell what schema this file is. Unconditional —
  // it is the one header write a boot with nothing pending makes (a pre-guard
  // file at 0 is healed here; U1's "nothing pending" boot-failure path, PR-1,
  // relies on it). v1.7.1 U3: the registry ordinal of the last migration in
  // the list passed (never the constant, never lower than the stamp so far);
  // a list with no registry migration stamps nothing.
  if (lastOrdinal !== undefined) {
    await db.execute(`PRAGMA user_version = ${Math.max(stamp, lastOrdinal)}`);
  }
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
  // 0050 adds the "Since your last visit" briefing stamps to app_settings
  // (Wave 13 / Direction 1): last_visit_date + briefing_baseline_date, two
  // nullable local-calendar-day TEXT columns. Two columns so a same-day
  // re-open keeps a stable baseline. Peers to last_seen_month (0046).
  ['0050_app_settings_briefing_stamps', () => import('./migrations/0050_app_settings_briefing_stamps.sql?raw')],
  // 0051 adds persons.monthly_expense_baseline: the durable per-person monthly
  // expense figure (D-B7 follow-up, approved). Nullable REAL, no backfill —
  // NULL keeps the Wave-B labeled even split of the household baseline; a
  // value upgrades person-scoped calculator defaults to "from {name}'s Inputs".
  ['0051_person_expense_baseline', () => import('./migrations/0051_person_expense_baseline.sql?raw')],
  // 0052 adds interview_answers — durable guided-interview answers
  // (thread/question/subject-keyed upsert rows; design §1.2).
  ['0052_interview_answers', () => import('./migrations/0052_interview_answers.sql?raw')],
  // 0053 adds nullable fifty_two_week_low/high to tickers — fetched by the
  // existing user-initiated refresh for the Positions table (D-P4 revised).
  ['0053_ticker_52_week', () => import('./migrations/0053_ticker_52_week.sql?raw')],
  // 0054 adds nullable vehicle_repair_category_ids to app_settings — the
  // interview repair-bucket override (Wave A item 7, closing D-GI15).
  ['0054_vehicle_repair_categories', () => import('./migrations/0054_vehicle_repair_categories.sql?raw')],
  // 0055 adds nullable regular_market_change/previous_close to tickers —
  // fetched by the existing user-initiated refresh (Positions Day change).
  ['0055_ticker_day_change', () => import('./migrations/0055_ticker_day_change.sql?raw')],
];

export async function loadAllMigrations(): Promise<Migration[]> {
  // Concurrent, order-preserving: Promise.all resolves in input order and
  // the imports are side-effect-free string modules (see registry doc).
  const modules = await Promise.all(MIGRATION_REGISTRY.map(([, load]) => load()));
  return MIGRATION_REGISTRY.map(([version], i) => ({ version, sql: modules[i].default }));
}
