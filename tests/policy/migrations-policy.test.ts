import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAllMigrations, MAX_SCHEMA_VERSION, runMigrations, type Migration } from '@/db/migrations';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { LAST_RELEASED_SCHEMA } from '../db/released-schemas';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'src', 'db', 'migrations');

// ---------------------------------------------------------------------------
// P1 ratchet: no NEW hand-curated data migrations.
//
// "Hand-curated" = a migration that writes data ROWS by hand: INSERT…VALUES
// seed rows, or statement-initial UPDATE/DELETE against user tables. This
// codebase shipped wrong hand-typed financial data before (tax tables — see
// the nominal-on-real gotcha class); new reference data belongs in a
// generated/seeded pipeline, or the allowlist below must be EXTENDED IN THE
// SAME PR with a review-visible diff. Schema DDL (CREATE/ALTER/DROP/PRAGMA)
// and INSERT…SELECT table rebuilds (e.g. 0033) pass free.
//
// Frozen 2026-07 (Wave 5). Extending this list is deliberate friction, not a
// bug — the failure message tells you exactly what to do.
// ---------------------------------------------------------------------------
const HAND_CURATED_DATA_ALLOWLIST: ReadonlySet<string> = new Set([
  '0001_initial',
  '0002_seed_tax_rules',
  '0004_seed_yonkers',
  '0006_seed_tickers',
  '0009_seed_categories',
  '0010_seed_merchant_mappings',
  '0011_seed_payment_categories',
  '0014_add_app_settings',
  '0030_enable_foreign_keys_and_orphan_cleanup',
  '0031_real_2026_tax_data',
  '0032_ltcg_brackets_2026',
  '0037_learning_state',
  '0038_seed_modern_etfs',
  '0039_default_daily_refresh',
  '0040_clear_synthetic_snapshots',
  // 0048 is a singleton default flip on learning_state (Wave 8 Learn redesign):
  // one UPDATE of a UI-preference row, no financial reference data.
  '0048_learning_preference_default',
  // 0049 deletes duplicate AMORTIZATION loan_payments rows (Wave 9 M37
  // corruption cleanup) before adding the partial UNIQUE index — a targeted
  // dedupe DELETE, no hand-typed reference data.
  '0049_loan_payments_unique_amortization',
]);

/** Mirror of the runner's pre-split comment strip (src/db/migrations.ts). */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Statement-level DML classifier. ON DELETE/ON UPDATE FK clauses are not
 * statement-initial, and INSERT…SELECT has no VALUES — neither trips this. */
function writesDataRows(sql: string): boolean {
  const statements = stripSqlComments(sql)
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return statements.some(
    (st) =>
      (/^insert\s+(or\s+\w+\s+)?into\b/i.test(st) && /\bvalues\s*\(/i.test(st)) ||
      /^update\b/i.test(st) ||
      /^delete\b/i.test(st),
  );
}

describe('migrations policy', () => {
  it('registry ↔ disk parity: every .sql file is registered, in filename order, and MAX_SCHEMA_VERSION matches', async () => {
    const migrations = await loadAllMigrations();
    const registered = migrations.map((m) => m.version);
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort() // zero-padded prefixes: lexicographic == apply order
      .map((f) => f.replace(/\.sql$/, ''));
    // Order-sensitive equality: catches unregistered files, ghosts registered
    // without a file, AND registry-order drift in one diff-friendly assert.
    expect(registered).toEqual(onDisk);
    expect(MAX_SCHEMA_VERSION).toBe(migrations.length);
  });

  it('hand-curated data ratchet: DML-writing migrations ⊆ frozen allowlist', async () => {
    const migrations = await loadAllMigrations();
    const offenders = migrations.filter((m) => writesDataRows(m.sql)).map((m) => m.version);
    const newOffenders = offenders.filter((v) => !HAND_CURATED_DATA_ALLOWLIST.has(v));
    if (newOffenders.length > 0) {
      throw new Error(
        [
          '',
          `New hand-curated data migration(s): ${newOffenders.join(', ')}`,
          '',
          'This migration writes data rows by hand (INSERT…VALUES / UPDATE / DELETE).',
          'Hand-typed reference data has shipped real financial errors before.',
          'Either generate the data via a seed pipeline, or — if hand-cured data is',
          'genuinely right here — add the version to HAND_CURATED_DATA_ALLOWLIST in',
          'tests/policy/migrations-policy.test.ts IN THE SAME PR so the reviewer sees it.',
          '',
        ].join('\n'),
      );
    }
    expect(newOffenders).toEqual([]);
  });

  it('allowlist hygiene: no stale entries (every allowlisted version still exists and still writes data)', async () => {
    const migrations = await loadAllMigrations();
    const offenders = new Set(migrations.filter((m) => writesDataRows(m.sql)).map((m) => m.version));
    const stale = [...HAND_CURATED_DATA_ALLOWLIST].filter((v) => !offenders.has(v));
    // A cleaned-up or renamed migration must shrink the allowlist with it —
    // a ratchet only ratchets if the frozen set can't quietly rot.
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// v1.7.1 U3 ratchet: a RELEASED migration never changes — not its SQL, not its
// registry KEY. The runner keys "already applied" by NAME
// (src/db/migrations.ts, the appliedSet in runMigrations), so a renamed key
// would silently re-run a shipped migration on every upgraded file, and an
// edited body would make fresh installs diverge from upgraded ones. Frozen
// 2026-09-26 from `git show "v1.7.0:src/db/migrations/<file>"` (equal, per
// ordinal, to every earlier tag — the planner's receipt). The SQL is hashed
// after normalizeShippedSql: the runner's line-comment strip, per-line trim,
// blank lines dropped — so 0005's comment-only edit (a191f105, before v1.1.0)
// and re-indentation hash the same, while any byte inside a statement,
// literals included, does not. A release that ships a NEW schema adds its row
// to tests/db/released-schemas.ts, and this list must grow to match (exactly
// LAST_RELEASED_SCHEMA rows — never ahead of a release).
// ---------------------------------------------------------------------------
const SHIPPED_MIGRATIONS: ReadonlyArray<readonly [key: string, sha256: string]> = [
  ['0001_initial', '5c86b556778a6c2dee866347455487483278427999688b45131a400782ce3983'],
  ['0002_seed_tax_rules', '267854b919998dab2af012d0e99b2a0000b7b1c7b16f79d9cd835c5869851ba1'],
  ['0003_add_commission_columns', '1b677c7a14095197800db266dff92ac14d86ba016b4522af870aebca7646cfe9'],
  ['0004_seed_yonkers', 'f9747e708be6372238b5a28540953bce41f5bf8c081aad9cf0106a2af950f284'],
  ['0005_add_employment_and_bonus_columns', '7a2aaeb6015ffebe4d5064fea6cab86e634fee3a1ad78a8323a3acedc1c5eee0'],
  ['0006_seed_tickers', '6ce61c4f13033adc483a92a0b256ee7f0653dbf67d20d56923f11211e349010f'],
  ['0007_add_account_margin', '837cc2fedd4d25c01b57b9dbe12aa437b41505ae812ed465ab6c46e3734bd0bd'],
  ['0008_add_transaction_property_links', '0f91c9f743c64533ea6c97a1d0d1d33accee2b42503eb11b37a0c49f847b3a52'],
  ['0009_seed_categories', '68b19ebd46992e6709135bbaed80cc66c9faa0004b3e0ae6d8daaea1d4a52310'],
  ['0010_seed_merchant_mappings', 'c0cb9f5d225da9253bc215679bd2acac726ba0d96aea5d761733137d67af78c6'],
  ['0011_seed_payment_categories', '8c0b4d65d45c21543a53fb251f9e45b4e63791b340ca110957a5ae3b39417339'],
  ['0012_add_transaction_person', '3fa149a10672731f83570153dd00dc4333c155a1b3afd64cede4b35bc42b9fe3'],
  ['0013_add_category_budget', 'ff50a7b0099f9bf3126ae026e653586b0d8dc2070adedc7cee47210bd8321d5a'],
  ['0014_add_app_settings', '0faaa77d843108f0e8b9a2b2f9d00e748fd638fe53384d272f815540b0b83899'],
  ['0015_add_accent_colors', '4848e0088e64fd7b75d5ab39374957892051e8ad9e7654d59be91749ec56d5a3'],
  ['0016_add_ticker_sector_industry', '3b7e412c04dad4a160b9c82e25d0b997a042973072b93af8fbd3893448768670'],
  ['0017_disclosure_foundations', '5b2d473c19fbe5fdae16868d5be4169ab43b293c647d32f43b671a90ef736b7f'],
  ['0018_roadmap_rule_engine', '327272496a609ac032747129c2551a398cea7e1e7af21dc6e3c9a0c729d68c55'],
  ['0019_scenarios', '339d32a647666194fb45be8a19e0fdbb127c8ef21a6786a7069599734f900e2a'],
  ['0020_whatif_defaults', '93b6f20bbe3636dc2adc94e4861809d886bb0be1800620c7741dfc7f739a954c'],
  ['0021_fund_sectors', 'd018f7a100ab7b487d470919a2b8ca05b69348261a0eaa8c5c26c28bc8d0ae38'],
  ['0022_fi_pills_position', '914a3e8ca8824df55e8429991e8d5d4d7238a4df4b090d402eef028548602107'],
  ['0023_projection_detail_level', '56df1d7a2c53140bc9a2ffd3671bce1ae401810e81d3783914f91649a43959e3'],
  ['0024_cash_apy', '27a90f8568a880182bb44f1879f84984b0642aa3189796beb0eba89ab56931d3'],
  ['0025_compounding_frequency', 'ea2209adc196b36bd014d19fd220c978545ee787e5dabb0b454049d7ff1ea3e3'],
  ['0026_asset_value_snapshots', '6c2111c43e69c63b84d71775adeafd6eff3c0dc216542b7054f1fdbee6222d12'],
  ['0027_equity_grant_company_valuation', '6afd6fab33f3b57c215d21857d19bfb03a3a458257d715c02d7c85d16af0d3c9'],
  ['0028_utility_category_config', '220392d226ebc46587082e06d97064fb15f2710ca8826c90252cebcfb21e632b'],
  ['0029_auto_invest_salary_surplus', '2454f9a0bcd132f540c4c424885c4a7deb301e5d75fdc6da0ec1cdd98aac79e6'],
  ['0030_enable_foreign_keys_and_orphan_cleanup', '6270821bb976deba95de641efddf3110ec92bc1fa480b31a15153e6797ed462b'],
  ['0031_real_2026_tax_data', '9e4d43f9d7cf9d19e9a20e5af75db520d4993dee94605454f96ea81d9b0d577c'],
  ['0032_ltcg_brackets_2026', 'a4718769e0f3576d6b082e28a874866590acf10512604f33e519fb6bac475886'],
  ['0033_fix_disclosure_acceptance_fk_actions', '4a42364e1b57ff178c6321c2055331ee4795ee0bf20914e93c7d1f998a3951db'],
  ['0034_add_query_indexes', 'e1d9d1d53ba1558d14c5e1e22c09a7bfd309ba1a7526ffa88da522d984c16067'],
  ['0035_add_default_drawdown_tax_rate', 'f1ad4694e9a18085343d531dca4c02492c63349dad19dc828354100ca482191d'],
  ['0036_add_rent_lease_tracking', 'c4a987148cf7cddaa8d07c3fab52c36f581aed7ffc2b9669aaadc1424dcd3235'],
  ['0037_learning_state', '9c547fabbbd3276a309db2f2541cbbb7b212f09bfd21e0c5345809cf90c15c98'],
  ['0038_seed_modern_etfs', '08f667b2de142b90b63f641b67ab9630c2a0dcda2eb33433d9af87b94f91b374'],
  ['0039_default_daily_refresh', 'cd2fe26aca73b4784a1f6e69c345d6089a73dc68ca965283b0762ac7e3c289da'],
  ['0040_clear_synthetic_snapshots', '7abd8ec159d54dc1c867287982b8dae3565ed1de2b87fbb0f46ed112c986f153'],
  ['0041_fund_holding_names', '7b9372c3fdae89675d9786b7cb6c74256fc4fe35fb2826bb86fc0ccce77a9744'],
  ['0042_investments_card_layout', 'a510c72e957033168af14bead0c85405e31a57010810710823f8a923dc4d12eb'],
  ['0043_drop_household_disclosure_columns', '87607ce3faf883a3f67667c98cd895b3797eab7cc91b9f0b6bb383e66a0fc905'],
  ['0044_equity_grant_type', '31453a4f4dd8b426ba535b260b65a61110cb1bccf7ace6400dee78ed167f59dd'],
  ['0045_asset_class_target_allocations', 'd6f65a9927c0cdb84e0d162a30ad5583356bb45b0a0c66bad48ed9f159f2c50f'],
  ['0046_app_settings_last_seen_month', '1bf3afaef26574b4fbac550ab5fe889795f82af47c1e714b58233a7f5e2d6119'],
  ['0047_calculators_card_layout', '79c97c671cfc42d9f7430b5e3e4a96754c63eae740f9a6690c149f0f33765642'],
  ['0048_learning_preference_default', '2db072ec03d179a459fd15ac1099bdc14f1d20fbd4b9d4104f5bb8d05ffcd239'],
  ['0049_loan_payments_unique_amortization', 'df15aa674ac6938ebd6ad3e932a29ef0dea41adf8a96eaac2e7edbf51c26bb58'],
  ['0050_app_settings_briefing_stamps', '96bddc15fb34278b7de06e055f29446ef957dfb6c6c81ac932ffd430b3668405'],
  ['0051_person_expense_baseline', 'd4a2ff63648cf86438af5db6219caa6fc54fa3e73801dff4f7fcde169645c201'],
  ['0052_interview_answers', 'ae458db819f909c2d53c86e3bec5fe9095e89141414f27282ec3b14a5a61c6a8'],
  ['0053_ticker_52_week', '799e2403a235b6e0dcb5ae326c47261c3b45d4d9efe38744b3ebd719d64f621c'],
  ['0054_vehicle_repair_categories', 'a00c5ff2495c7f73c73317a7b8a4276b3f4c88cf3ac15aeb099b16ea67d4a2d4'],
  ['0055_ticker_day_change', 'e8b16af0777d2f66a5c23b5ccdfe436823bd2537dfe878f777942e1bc52e9bb3'],
];

/** Frozen with the table above: changing it re-hashes every row. */
function normalizeShippedSql(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The released keys whose registry key or normalized SQL no longer match the frozen table (planted below, plan review R-3b). */
function movedShippedMigrations(migrations: ReadonlyArray<{ version: string; sql: string }>): string[] {
  return SHIPPED_MIGRATIONS.filter(
    ([key, hash], i) => migrations[i]?.version !== key || sha256(normalizeShippedSql(migrations[i].sql)) !== hash,
  ).map(([key]) => key);
}

/**
 * v1.8.0 T12 (post-release review L16/L41): the registry migrations that
 * tests/db/released-schemas.ts records as released (ordinals up to
 * `lastReleased`) but that the frozen table has no row for yet — the state
 * right after a schema-bumping release commit adds its released-schemas row —
 * each with the sha256 of its normalized SQL, ready to paste ([] = every
 * released migration has its frozen row). A row that IS in the table but hashes
 * differently stays a shipped-SQL change: the table cannot tell that apart from
 * a wrong first freeze, so it never prints a hash for one.
 */
function unfrozenReleasedRows(
  migrations: ReadonlyArray<{ version: string; sql: string }>,
  frozen: ReadonlyArray<readonly [key: string, sha256: string]>,
  lastReleased: number,
): Array<{ key: string; hash: string }> {
  return migrations
    .slice(frozen.length, lastReleased)
    .map((m) => ({ key: m.version, hash: sha256(normalizeShippedSql(m.sql)) }));
}

/** The live check's reading: the real frozen table against the newest released schema (tests/db/released-schemas.ts). */
const unfrozenNow = (migrations: ReadonlyArray<{ version: string; sql: string }>) =>
  unfrozenReleasedRows(migrations, SHIPPED_MIGRATIONS, LAST_RELEASED_SCHEMA);

/** The failure text for unfrozenReleasedRows: the count mismatch, then per migration the instruction and its row. */
function freezeMessage(unfrozen: ReadonlyArray<{ key: string; hash: string }>, frozenCount: number, lastReleased: number): string {
  return [
    '',
    `tests/db/released-schemas.ts records schema ${lastReleased} as released, and SHIPPED_MIGRATIONS holds ${frozenCount} rows.`,
    '',
    ...unfrozen.flatMap(({ key, hash }) => [
      `${key}: freeze this newly released migration. Append its row (the key and the sha256 of its normalized SQL) to SHIPPED_MIGRATIONS:`,
      `  ['${key}', '${hash}'],`,
    ]),
    '',
    'The release commit carries these rows with its released-schemas row (docs/RELEASING.md; tests/db/released-schemas.ts).',
    '',
  ].join('\n');
}

describe('released-migration immutability (v1.7.1 U3)', () => {
  it('the frozen table covers exactly the released ordinals (1..LAST_RELEASED_SCHEMA)', () => {
    expect(SHIPPED_MIGRATIONS).toHaveLength(LAST_RELEASED_SCHEMA);
  });

  it('the registry KEY STRINGS of every released migration are frozen (a rename would re-run a shipped migration)', async () => {
    const migrations = await loadAllMigrations();
    expect(migrations.slice(0, LAST_RELEASED_SCHEMA).map((m) => m.version)).toEqual(SHIPPED_MIGRATIONS.map(([key]) => key));
  });

  it('the normalized SQL of every released migration hashes to its frozen value', async () => {
    const moved = movedShippedMigrations(await loadAllMigrations());
    if (moved.length > 0) {
      throw new Error(
        [
          '',
          `Shipped migration SQL changed: ${moved.join(', ')}`,
          '',
          'These migrations are in a released build, so upgraded files already ran the old SQL.',
          'Put the change in a NEW migration (append a row to the registry and bump',
          'MAX_SCHEMA_VERSION in both pins); the released SQL stays as it shipped.',
          '',
        ].join('\n'),
      );
    }
    expect(moved).toEqual([]);
  });

  // v1.8.0 T12 (post-release review L16/L41): a schema-bumping release commit
  // adds its released-schemas row, and the length pin above then fails with a
  // bare count. This check fails in the same run and prints the row to paste.
  it('every migration tests/db/released-schemas.ts records as released has its frozen row; a missing one prints the row to paste', async () => {
    const unfrozen = unfrozenNow(await loadAllMigrations());
    if (unfrozen.length > 0) throw new Error(freezeMessage(unfrozen, SHIPPED_MIGRATIONS.length, LAST_RELEASED_SCHEMA));
    expect(unfrozen).toEqual([]);
  });

  it('the freeze message is real: a table missing its last row reports that migration, its frozen sha256 and "freeze this newly released migration" (planted)', async () => {
    const migrations = await loadAllMigrations();
    const [lastKey, lastHash] = SHIPPED_MIGRATIONS[SHIPPED_MIGRATIONS.length - 1];
    const frozen = SHIPPED_MIGRATIONS.slice(0, -1);
    const unfrozen = unfrozenReleasedRows(migrations, frozen, SHIPPED_MIGRATIONS.length);
    expect(unfrozen).toEqual([{ key: lastKey, hash: lastHash }]);
    const message = freezeMessage(unfrozen, frozen.length, SHIPPED_MIGRATIONS.length);
    expect(message).toContain(`${lastKey}: freeze this newly released migration.`);
    expect(message).toContain(`  ['${lastKey}', '${lastHash}'],`);
    expect(message).toContain('docs/RELEASING.md');
    expect(message).toContain(
      `records schema ${SHIPPED_MIGRATIONS.length} as released, and SHIPPED_MIGRATIONS holds ${frozen.length} rows.`,
    );
    expect(unfrozenReleasedRows(migrations, SHIPPED_MIGRATIONS, SHIPPED_MIGRATIONS.length)).toEqual([]);
    expect(unfrozenReleasedRows(migrations, SHIPPED_MIGRATIONS, SHIPPED_MIGRATIONS.length - 1)).toEqual([]);
    // T12 code review: the upper bound is real. With the released schema BELOW
    // the registry length, only the migrations up to it are asked for a row.
    expect(unfrozenReleasedRows(migrations, SHIPPED_MIGRATIONS.slice(0, 53), 54)).toEqual([
      { key: SHIPPED_MIGRATIONS[53][0], hash: SHIPPED_MIGRATIONS[53][1] },
    ]);
    // …and the live check reads LAST_RELEASED_SCHEMA: a migration the registry
    // gains before its release (main ahead of the last tag) changes nothing.
    expect(unfrozenNow([...migrations, { version: '9999_unreleased_plant', sql: 'SELECT 1;' }])).toEqual(unfrozenNow(migrations));
  });

  it('every registry key\'s 4-digit prefix is its 1-based registry position (the ordinal the runner stamps)', async () => {
    const migrations = await loadAllMigrations();
    expect(migrations.map((m, i) => Number(m.version.slice(0, 4)) === i + 1).every(Boolean)).toBe(true);
  });

  it('the comparison is real: a changed byte in 0005 and a renamed 0033 key are both reported, and nothing else (planted)', async () => {
    const shipped = await loadAllMigrations();
    expect(movedShippedMigrations(shipped)).toEqual([]);
    const planted = shipped.map((m) =>
      m.version === '0005_add_employment_and_bonus_columns'
        ? { ...m, sql: m.sql.replace("'SALARY_NO_OT'", "'SALARY'") }
        : m.version === '0033_fix_disclosure_acceptance_fk_actions'
          ? { ...m, version: '0033_fix_disclosure_fk_actions' }
          : m,
    );
    expect(planted[4].sql, 'the 0005 plant did not apply').not.toBe(shipped[4].sql);
    expect(movedShippedMigrations(planted)).toEqual([
      '0005_add_employment_and_bonus_columns',
      '0033_fix_disclosure_acceptance_fk_actions',
    ]);
  });

  it('normalizeShippedSql ignores comments and indentation but not a byte inside a statement', () => {
    const shipped = '-- 0099_x.sql\n-- why: a header\nALTER TABLE t ADD COLUMN c TEXT;\n';
    expect(normalizeShippedSql('-- 0099_x.sql\n-- why: a reworded header\n\n   ALTER TABLE t ADD COLUMN c TEXT;   \n')).toBe(normalizeShippedSql(shipped));
    expect(normalizeShippedSql("ALTER TABLE t ADD COLUMN c TEXT DEFAULT 'a  b';")).not.toBe(normalizeShippedSql("ALTER TABLE t ADD COLUMN c TEXT DEFAULT 'a b';"));
    expect(normalizeShippedSql('ALTER TABLE t ADD COLUMN c TEXT;')).not.toBe(normalizeShippedSql('ALTER TABLE t ADD COLUMN c INTEGER;'));
  });
});

// ---------------------------------------------------------------------------
// v1.8.0 H1 (post-release review L13): what the runner's wrap does to the
// foreign-keys PRAGMA, read from the batches the runner itself sends. Every
// migration runs as ONE executeBatch, wrapped in the runner's transaction
// unless its own statements open one (a statement-initial BEGIN: 0033).
// SQLite ignores `PRAGMA foreign_keys` inside a transaction, so a wrapped
// textbook table rebuild (foreign keys OFF, CREATE new, INSERT … SELECT, DROP
// old, RENAME) runs with foreign keys ON: the DROP's implicit DELETE fires
// every ON DELETE SET NULL / CASCADE into the child rows, while quick_check,
// foreign_key_check and the upgrade harness's row counts all pass. A fresh
// chain runs every registry migration, so watching it covers the registry,
// with the runner's own statement split and its own self-managed test.
// ---------------------------------------------------------------------------

/** One migration's batch, as the runner sent it. */
interface RunnerBatch {
  version: string;
  wrapped: boolean;
  statements: string[];
}

/** The runner's audit row (src/db/migrations.ts); its parameter names the migration. */
const AUDIT_INSERT = 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)';

/**
 * Run `migrations` on a fresh in-memory file and record every batch the runner
 * sends: the migration it belongs to (its audit row), whether the runner
 * wrapped it, and its statements. `inspect` reads the file before it closes.
 */
async function observeRunner(migrations: Migration[], inspect?: (db: SqliteAdapter) => Promise<void>): Promise<RunnerBatch[]> {
  const db = new SqliteAdapter(':memory:');
  const batches: RunnerBatch[] = [];
  const real = db.executeBatch.bind(db);
  db.executeBatch = async (statements, options) => {
    const audit = statements.find((st) => st.sql === AUDIT_INSERT);
    batches.push({
      version: String(audit?.params?.[0] ?? '(no audit row)'),
      wrapped: options?.transaction ?? true,
      statements: statements.map((st) => st.sql),
    });
    return real(statements, options);
  };
  try {
    await runMigrations(db, migrations);
    await inspect?.(db);
  } finally {
    await db.close();
  }
  return batches;
}

/** A statement's SQL with every block comment replaced by a space, trimmed: the runner strips only line comments (`--`), and SQLite reads a block comment as a space anywhere in a statement (a comment between PRAGMA and foreign_keys still turns foreign keys off, probed). */
function withoutBlockComments(statement: string): string {
  return statement.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
}

/**
 * A statement that sets the foreign-keys PRAGMA: any case, any spacing, an
 * optional schema prefix, and either name bare or quoted ("…", `…`, […] or
 * '…'; SQLite accepts each, probed), tested after withoutBlockComments, so a
 * block comment anywhere in the statement reads as a space. Not
 * `defer_foreign_keys`, which works inside a transaction.
 */
const FOREIGN_KEYS_PRAGMA = /^PRAGMA\b\s*(?:["'`\[]?\w+["'`\]]?\s*\.\s*)?["'`\[]?foreign_keys\b/i;

/** A self-managed migration's own transaction statements, statement-initial (the runner's own BEGIN test is statement-initial too). */
const OPENS_TRANSACTION = /^BEGIN\b/i;
const CLOSES_TRANSACTION = /^(?:COMMIT|END)\b|^ROLLBACK(?:\s+TRANSACTION)?$/i;

/** True when a foreign-keys PRAGMA in this batch runs inside a transaction: anywhere in a wrapped batch, or between a self-managed migration's own BEGIN and its COMMIT. */
function setsForeignKeysInATransaction(b: RunnerBatch): boolean {
  let open = b.wrapped;
  for (const statement of b.statements) {
    const st = withoutBlockComments(statement);
    if (open && FOREIGN_KEYS_PRAGMA.test(st)) return true;
    if (!b.wrapped && OPENS_TRANSACTION.test(st)) open = true;
    if (!b.wrapped && CLOSES_TRANSACTION.test(st)) open = false;
  }
  return false;
}

/** The migrations whose foreign-keys PRAGMA runs inside a transaction (the runner's wrap, or the migration's own BEGIN), where SQLite ignores it (L13). */
function wrappedForeignKeyPragmas(batches: readonly RunnerBatch[]): string[] {
  return batches.filter(setsForeignKeysInATransaction).map((b) => b.version);
}

/** Planted tables for the self-tests: a parent with a SET NULL child and a CASCADE child, one row each. */
const PLANT_TABLES: Migration = {
  version: 'h1_plant_tables',
  sql: [
    'CREATE TABLE h1_parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
    'CREATE TABLE h1_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES h1_parent(id) ON DELETE SET NULL);',
    'CREATE TABLE h1_owned (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES h1_parent(id) ON DELETE CASCADE);',
    "INSERT INTO h1_parent (id, name) VALUES (1, 'Ada');",
    'INSERT INTO h1_child (id, parent_id) VALUES (1, 1);',
    'INSERT INTO h1_owned (id, parent_id) VALUES (1, 1);',
  ].join('\n'),
};

/** The textbook rebuild of h1_parent, opened by `pragmaOff`; `ownBegin` gives it its own BEGIN … COMMIT, as 0033 has. */
function plantedRebuild(version: string, pragmaOff: string, ownBegin: boolean): Migration {
  return {
    version,
    sql: [
      `${pragmaOff};`,
      ...(ownBegin ? ['BEGIN TRANSACTION;'] : []),
      'CREATE TABLE h1_parent__new (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      'INSERT INTO h1_parent__new (id, name) SELECT id, name FROM h1_parent;',
      'DROP TABLE h1_parent;',
      'ALTER TABLE h1_parent__new RENAME TO h1_parent;',
      ...(ownBegin ? ['COMMIT;'] : []),
      'PRAGMA foreign_keys = ON;',
    ].join('\n'),
  };
}

/** What the planted tables hold after a run, and what the release gate's integrity checks say about them. */
async function plantState(db: SqliteAdapter): Promise<Record<string, unknown>> {
  return {
    parent: await db.select('SELECT id, name FROM h1_parent'),
    child: await db.select('SELECT id, parent_id FROM h1_child'),
    owned: await db.select('SELECT id FROM h1_owned'),
    quickCheck: await db.select('PRAGMA quick_check'),
    foreignKeyCheck: await db.select('PRAGMA foreign_key_check'),
  };
}

describe('the foreign-keys PRAGMA never runs inside the runner\'s wrap (v1.8.0 H1, post-release review L13)', () => {
  let shipped: RunnerBatch[];
  beforeAll(async () => {
    shipped = await observeRunner(await loadAllMigrations());
  });

  it('a fresh chain sends one batch per registry migration, in order, each with its audit row (what these checks read)', async () => {
    expect(shipped.map((b) => b.version)).toEqual((await loadAllMigrations()).map((m) => m.version));
  });

  it('no wrapped migration sets PRAGMA foreign_keys: a table rebuild that needs foreign keys off opens its own transaction between the two PRAGMAs, as 0033 does', () => {
    const offenders = wrappedForeignKeyPragmas(shipped);
    if (offenders.length > 0) {
      throw new Error(
        [
          '',
          `Wrapped migration(s) set PRAGMA foreign_keys: ${offenders.join(', ')}`,
          '',
          'The runner wraps a migration in one transaction unless the migration opens its own',
          '(a statement-initial BEGIN), and SQLite ignores PRAGMA foreign_keys inside a transaction.',
          'A table rebuild then runs with foreign keys ON, and its DROP TABLE nulls or deletes the',
          'child rows (ON DELETE SET NULL / CASCADE) while every integrity check passes.',
          'Put BEGIN TRANSACTION … COMMIT between the two PRAGMAs, as 0033 does: OFF before the BEGIN,',
          'ON after the COMMIT (a PRAGMA after the migration\'s own BEGIN is ignored the same way, and is',
          'reported here too). The self-managed ratchet below then names the migration (post-release',
          'review L17).',
          '',
        ].join('\n'),
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the check is real: a planted rebuild with PRAGMA foreign_keys = OFF and no BEGIN is reported, and on this engine it nulls and deletes the child rows while quick_check and foreign_key_check pass (planted)', async () => {
    let state: Record<string, unknown> = {};
    const batches = await observeRunner([PLANT_TABLES, plantedRebuild('h1_planted_rebuild', 'PRAGMA foreign_keys = OFF', false)], async (db) => {
      state = await plantState(db);
    });
    expect(wrappedForeignKeyPragmas(batches)).toEqual(['h1_planted_rebuild']);
    expect(state).toEqual({
      parent: [{ id: 1, name: 'Ada' }],
      child: [{ id: 1, parent_id: null }], // ON DELETE SET NULL fired
      owned: [], // ON DELETE CASCADE fired
      quickCheck: [{ quick_check: 'ok' }],
      foreignKeyCheck: [],
    });
  });

  it('any spelling is reported (lower case, no spaces, a schema prefix bare or quoted, the name in each of SQLite\'s four quotes, a block comment before or inside the statement), and so is one after a migration\'s own BEGIN, plain or BEGIN TRANSACTION, also after a ROLLBACK TO inside it; defer_foreign_keys, which works inside a transaction, is not (planted)', async () => {
    const batches = await observeRunner([
      { version: 'h1_planted_lower', sql: 'pragma foreign_keys=off;\nCREATE TABLE h1_lower (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_schema', sql: 'PRAGMA main.foreign_keys = 0;\nCREATE TABLE h1_schema (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_quoted', sql: 'PRAGMA "foreign_keys" = OFF;\nCREATE TABLE h1_quoted (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_bracket_schema', sql: 'PRAGMA [main].foreign_keys = 0;\nCREATE TABLE h1_bracket (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_block_comment', sql: '/* rebuild */ PRAGMA foreign_keys = OFF;\nCREATE TABLE h1_commented (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_in_own_tx', sql: 'BEGIN TRANSACTION;\nPRAGMA foreign_keys = OFF;\nCREATE TABLE h1_in_own_tx (id INTEGER PRIMARY KEY);\nCOMMIT;' },
      { version: 'h1_planted_backtick', sql: 'PRAGMA `foreign_keys` = OFF;\nCREATE TABLE h1_backtick (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_single_quote', sql: "PRAGMA 'foreign_keys' = OFF;\nCREATE TABLE h1_single_quote (id INTEGER PRIMARY KEY);" },
      { version: 'h1_planted_bracket_name', sql: 'PRAGMA [foreign_keys] = OFF;\nCREATE TABLE h1_bracket_name (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_quoted_schema', sql: 'PRAGMA "main"."foreign_keys" = 0;\nCREATE TABLE h1_quoted_schema (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_inner_comment', sql: 'PRAGMA /* x */ foreign_keys = OFF;\nCREATE TABLE h1_inner_comment (id INTEGER PRIMARY KEY);' },
      { version: 'h1_planted_in_plain_begin', sql: 'BEGIN;\nPRAGMA foreign_keys = OFF;\nCREATE TABLE h1_in_plain_begin (id INTEGER PRIMARY KEY);\nCOMMIT;' },
      { version: 'h1_planted_after_rollback_to', sql: 'BEGIN;\nSAVEPOINT h1_sp;\nROLLBACK TO SAVEPOINT h1_sp;\nPRAGMA foreign_keys = OFF;\nCREATE TABLE h1_after_rollback_to (id INTEGER PRIMARY KEY);\nCOMMIT;' },
      { version: 'h1_planted_defer', sql: 'PRAGMA defer_foreign_keys = ON;\nCREATE TABLE h1_deferred (id INTEGER PRIMARY KEY);' },
    ]);
    expect(wrappedForeignKeyPragmas(batches)).toEqual([
      'h1_planted_lower',
      'h1_planted_schema',
      'h1_planted_quoted',
      'h1_planted_bracket_schema',
      'h1_planted_block_comment',
      'h1_planted_in_own_tx',
      'h1_planted_backtick',
      'h1_planted_single_quote',
      'h1_planted_bracket_name',
      'h1_planted_quoted_schema',
      'h1_planted_inner_comment',
      'h1_planted_in_plain_begin',
      'h1_planted_after_rollback_to',
    ]);
  });
});

// ---------------------------------------------------------------------------
// v1.8.0 H1 (post-release review L17): a self-managed migration runs without
// the runner's wrap. If one of its statements fails, nothing rolls it back:
// the connection keeps its open transaction, with foreign keys off. Its audit
// row, chain marker and user_version stamp run after its own COMMIT, so a
// force-quit in between re-runs it on every boot. For 0033: every upgrading
// file already has it, a fresh install runs it on an empty file (no user rows
// yet), and its rebuild re-runs cleanly (tests/db/upgrade-path.test.ts). The
// no-ROLLBACK path stays open for first launches until the chip "Make the
// runner safe for a second self-managed migration" lands. Until then, the set
// is exactly 0033.
// ---------------------------------------------------------------------------
const SELF_MANAGED_MIGRATIONS: readonly string[] = ['0033_fix_disclosure_acceptance_fk_actions'];

/** The migrations the runner ran self-managed: unwrapped, on their own BEGIN. */
function selfManagedMigrations(batches: readonly RunnerBatch[]): string[] {
  return batches.filter((b) => !b.wrapped).map((b) => b.version);
}

describe('the self-managed migrations are exactly 0033 (v1.8.0 H1, post-release review L17)', () => {
  it('a fresh chain runs exactly 0033 unwrapped', async () => {
    const selfManaged = selfManagedMigrations(await observeRunner(await loadAllMigrations()));
    if (selfManaged.join('\n') !== SELF_MANAGED_MIGRATIONS.join('\n')) {
      throw new Error(
        [
          '',
          `The runner ran these migrations self-managed: ${selfManaged.join(', ') || '(none)'}.`,
          `The ratchet allows exactly: ${SELF_MANAGED_MIGRATIONS.join(', ')}.`,
          '',
          'A self-managed migration (a statement-initial BEGIN) runs without the runner\'s wrap. If one',
          'of its statements fails, nothing rolls it back: the connection keeps its open transaction,',
          'with foreign keys off. Its audit row, chain marker and user_version stamp run after its own',
          'COMMIT, so a force-quit in between re-runs it on every boot. Make the runner safe for it',
          'first (post-release review L17), then extend SELF_MANAGED_MIGRATIONS in',
          'tests/policy/migrations-policy.test.ts in the same change.',
          '',
        ].join('\n'),
      );
    }
    expect(selfManaged).toEqual(SELF_MANAGED_MIGRATIONS);
  });

  it('the ratchet is real, and so is the remedy the PRAGMA check names: the planted rebuild with its own BEGIN runs unwrapped, is named here and not there, and keeps its child rows (planted)', async () => {
    let state: Record<string, unknown> = {};
    const batches = await observeRunner([PLANT_TABLES, plantedRebuild('h1_planted_own_begin', 'PRAGMA foreign_keys = OFF', true)], async (db) => {
      state = await plantState(db);
    });
    expect(selfManagedMigrations(batches)).toEqual(['h1_planted_own_begin']);
    expect(wrappedForeignKeyPragmas(batches)).toEqual([]);
    expect(state).toEqual({
      parent: [{ id: 1, name: 'Ada' }],
      child: [{ id: 1, parent_id: 1 }],
      owned: [{ id: 1 }],
      quickCheck: [{ quick_check: 'ok' }],
      foreignKeyCheck: [],
    });
  });
});
