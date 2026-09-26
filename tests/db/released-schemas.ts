/**
 * v1.7.1 U3 — every released Cairn tag and the schema it shipped
 * (MAX_SCHEMA_VERSION in src/db/migrations.ts AND src-tauri/src/db_backup.rs at
 * that tag; the two agree at every tag). FROZEN, and re-derived from the real
 * tags, never hand-typed: `node scripts/released-schema-guard.mjs --all`
 * re-checks every row against `git show "<tag>:…"`, and release.yml's test gate
 * checks the previous tag's row, and the release's own row against its
 * checked-out pins, before anything builds. One row per tag, in version order,
 * exactly `  'vX.Y.Z': N,` — the guard reads this file as text. A release
 * commit adds its own row (docs/RELEASING.md); the gate refuses a release
 * without it.
 *
 * v1.8.0 T12 (post-release review L16/L41) — the release commit, step by step.
 * docs/RELEASING.md has the whole procedure, but docs/ is not in a clone, so
 * the steps the tests enforce are also here:
 *   1. this release's row, last, where N is MAX_SCHEMA_VERSION in
 *      src/db/migrations.ts and in src-tauri/src/db_backup.rs (the two agree);
 *   2. schema-bumping releases only: the new migration's row appended to
 *      SHIPPED_MIGRATIONS in tests/policy/migrations-policy.test.ts (once step 1
 *      lands, its frozen-row check fails and prints the row to paste), and, when
 *      the migration creates a new table, a row for that table in seedAtSchema
 *      (tests/db/upgrade-path-seed.ts), or tests/db/upgrade-path.test.ts's
 *      "every user table holds a row" check fails.
 * Before committing, run `node scripts/released-schema-guard.mjs vX.Y.Z` and the
 * four files of release.yml's "Upgrade path from every released schema" step;
 * `--all` passes only once the tag exists (the release gate runs it there).
 */
export const RELEASED_SCHEMAS: Readonly<Record<string, number>> = Object.freeze({
  'v1.0.0': 47,
  'v1.0.1': 47,
  'v1.0.2': 47,
  'v1.1.0': 50,
  'v1.1.1': 50,
  'v1.2.0': 51,
  'v1.3.0': 52,
  'v1.4.0': 53,
  'v1.5.0': 55,
  'v1.6.0': 55,
  'v1.7.0': 55,
  'v1.7.1': 55,
  'v1.7.2': 55,
});

/** The distinct schemas a released build ever left a file at, ascending — the upgrade harness starts from each. */
export const DISTINCT_RELEASED_SCHEMAS: readonly number[] = Object.freeze(
  [...new Set(Object.values(RELEASED_SCHEMAS))].sort((a, b) => a - b),
);

/** The newest released schema: migrations 1..LAST_RELEASED_SCHEMA have shipped, so their SQL and names are frozen (tests/policy/migrations-policy.test.ts). */
export const LAST_RELEASED_SCHEMA: number = Math.max(...Object.values(RELEASED_SCHEMAS));
