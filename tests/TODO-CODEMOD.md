# TODO: hand-curated migration sweep

**Status (2026-05-27):** 55 test files still use `runMigrations(db, [...subset...])`. Sprint-3 testing reviewer flagged this as a 1-day sweep (see `docs/reviews/2026-05-27-testing-wave3.md` § N6).

This file documents the exact transform so the next teammate can execute it mechanically.

## Why this matters

Each migration that adds a column to a hot table (`categories`, `accounts`, `persons`, `transactions`, `tax_rules`, …) gambles on which of the 55 hand-curated test files break in confusing ways. The canonical fix is to use `loadAllMigrations()` everywhere, mirroring `tests/components/InputsLayoutSmoke.test.tsx:60-71`:

```ts
// good (canonical pattern)
import { loadAllMigrations, runMigrations } from '@/db/migrations';
// ...
await runMigrations(db, await loadAllMigrations());

// bad (hand-curated subset, brittle on every schema add)
await runMigrations(db, [
  mig('0001_initial'),
  mig('0008_add_transaction_property_links'),
  // ...
]);
```

## Two source variants to detect

The 55 files use one of two shapes:

### Variant A — local `mig()` helper (~40 files)

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '@/db/migrations';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

// later:
await runMigrations(db, [
  mig('0001_initial'),
  mig('0009_seed_categories'),
  // ...
]);
```

### Variant B — per-migration `loadXMigration()` helpers (~15 files)

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '@/db/migrations';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');

// later:
await runMigrations(db, [
  { version: '0001_initial', sql: loadInitialMigration() },
  { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
]);
```

## Transform

Both variants collapse to the same target:

```ts
import { loadAllMigrations, runMigrations } from '@/db/migrations';

// later:
await runMigrations(db, await loadAllMigrations());
```

Plus:
- Drop `readFileSync`, `resolve` imports if they're no longer referenced after the substitution.
- Drop the `mig` or `loadXMigration` helper functions.
- Add `loadAllMigrations` to the existing `@/db/migrations` import (or merge with it if separate).

## Suggested implementation (Node, ~150 lines)

Path: `scripts/codemods/sweep-hand-curated-migrations.mjs`.

Strategy: read each file as text, run a small set of replacements, run `npm test`, fix any test that depended on a column being absent (those are real bugs masquerading as passing tests). Skip files that already use `loadAllMigrations()`.

Pseudocode:

```js
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TEST_ROOT = 'tests';
const targets = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.test.ts') || p.endsWith('.test.tsx')) targets.push(p);
  }
}
walk(TEST_ROOT);

const HAND_CURATED_CALL = /await\s+runMigrations\(db,\s*\[[\s\S]*?\]\s*\)/g;

for (const file of targets) {
  let src = readFileSync(file, 'utf-8');
  if (!HAND_CURATED_CALL.test(src)) continue;
  if (src.includes('loadAllMigrations()')) continue; // already correct

  // 1. Replace the runMigrations call (works for both variants).
  src = src.replace(
    HAND_CURATED_CALL,
    'await runMigrations(db, await loadAllMigrations())',
  );

  // 2. Ensure loadAllMigrations is imported.
  src = src.replace(
    /from\s+['"]@\/db\/migrations['"]/,
    (match, _offset, _full) => match, // no-op; modify line below
  );
  src = src.replace(
    /import\s*\{\s*runMigrations\s*\}\s*from\s*['"]@\/db\/migrations['"]/,
    `import { loadAllMigrations, runMigrations } from '@/db/migrations'`,
  );
  // (handle the case where runMigrations was already imported with other names)

  // 3. Strip now-unused helpers (`mig`, `load*Migration`) and
  //    `readFileSync` / `resolve` imports if they're no longer used.
  //    Easier to do this as a follow-up `eslint --fix --rule '{no-unused-vars: error}'`
  //    pass than to write the AST work here.

  writeFileSync(file, src);
}
```

## Acceptance criteria for the sweep

1. `grep -rl "runMigrations(db, \[" tests/ | wc -l` reports `0`.
2. `npm test` passes (no regressions; each previously-hand-curated test now runs against the full schema).
3. Any test that breaks because it depended on a column being null at a migration-cutoff version is fixed (root-cause: the test was *already wrong* — it implicitly asserted a schema that doesn't match production).
4. `npx eslint --fix tests/` strips unused `readFileSync`/`resolve`/`mig` symbols.
5. New file: `scripts/codemods/sweep-hand-curated-migrations.mjs` (committed for reproducibility).
6. New ESLint rule (or simple grep-based pre-commit check) forbidding `runMigrations(db, [` in `tests/**/*.test.{ts,tsx}` going forward. Recommended: a small custom rule via `eslint-plugin-local-rules` named `no-hand-curated-migrations`. The grep approach is faster to ship:

   ```sh
   # scripts/hooks/pre-commit, near the end
   if git diff --cached --name-only -- 'tests/**/*.test.*' | xargs -I{} grep -nE "runMigrations\(db, \[" {} 2>/dev/null; then
     echo "[pre-commit] hand-curated migration found — use loadAllMigrations()." >&2
     exit 1
   fi
   ```

## Effort estimate

- Codemod script: 1–2h
- Run + triage breakages: 2–4h (some tests will surface real schema-dependency bugs)
- ESLint rule or grep check: 30 min
- Commit hygiene + reviewer cycle: 1h

Total: ~1 working day, matching the Wave-3 review's estimate.

## Risk

The most likely source of test breakage is a test that asserts a column is NULL or absent because the migration that adds it (e.g., `0028_utility_category_config`) was deliberately excluded. With the full schema applied, the column will be NULL (default) — same value, but the assertion may have been written against `undefined`. Fix: change `toBe(undefined)` → `toBe(null)`, and audit the test for whether the "absence" was the actual contract being tested or just an artifact of the subset.
