// Pre-commit path mapping: staged file list (stdin, one per line) → extra
// vitest paths (stdout, space-separated). Used by scripts/hooks/pre-commit's
// fast lane to close four verified `vitest --changed` blind spots:
//
//   1. tests/policy — policy tests read source files via node:fs, so the
//      import graph never links them to anything; --changed NEVER selects
//      them. Appended unconditionally (the suite is a few seconds of file
//      walks; cheap enough for every commit).
//   2. tests/db — vitest's changed-file tracing does not follow
//      `import('./migrations/NNNN_name.sql?raw')`, so a staged migration
//      .sql runs ZERO tests on the fast lane. Any staged
//      src/db/migrations/*.sql maps to the whole tests/db suite.
//   3. tests/e2e-harness — the spec-timeout ratchet reads e2e/*.spec.ts
//      through node:fs, so a staged spec selects nothing (v1.8.0 T12;
//      code-review-I m11). Any staged path under e2e/ maps to the whole
//      tests/e2e-harness suite (a few seconds).
//   4. tests/config — its pins read src/lib/browser-shims/README.md,
//      .claude/launch.json and .github/workflows/*.yml through node:fs, so a
//      staged copy of one of them selects nothing (v1.8.0 T12 code review).
//      Each maps to the whole tests/config suite (a few seconds).
//
// Pure function + thin stdin wrapper so tests/scripts/extra-test-paths.test.ts
// can unit-test the mapping without spawning a process. Zero dependencies —
// this runs inside the git hook.

const MIGRATION_SQL_RE = /^src\/db\/migrations\/[^/]+\.sql$/;
const E2E_PATH_RE = /^e2e\//;
const CONFIG_READ_RES = [/^src\/lib\/browser-shims\/README\.md$/, /^\.claude\/launch\.json$/, /^\.github\/workflows\//];

/**
 * @param {string[]} stagedFiles repo-relative paths (git always emits `/`
 *   separators, even on Windows).
 * @returns {string[]} vitest path filters to run in a second pass.
 */
export function extraTestPaths(stagedFiles) {
  const out = ['tests/policy'];
  if (stagedFiles.some((f) => MIGRATION_SQL_RE.test(f))) {
    out.push('tests/db');
  }
  if (stagedFiles.some((f) => E2E_PATH_RE.test(f))) {
    out.push('tests/e2e-harness');
  }
  if (stagedFiles.some((f) => CONFIG_READ_RES.some((re) => re.test(f)))) {
    out.push('tests/config');
  }
  return out;
}

// CLI mode: `git diff --cached --name-only | node extra-test-paths.mjs`
// (import.meta.main is not available on Node 20; compare resolved paths.)
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const files = input.split('\n').map((l) => l.trim()).filter(Boolean);
    process.stdout.write(extraTestPaths(files).join(' '));
  });
}
