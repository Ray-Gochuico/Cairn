import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllMigrations, MAX_SCHEMA_VERSION } from '@/db/migrations';

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
