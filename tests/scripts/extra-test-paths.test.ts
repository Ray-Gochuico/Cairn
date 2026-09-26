import { describe, it, expect } from 'vitest';
import { extraTestPaths } from '../../scripts/hooks/extra-test-paths.mjs';

describe('extraTestPaths (pre-commit path mapping)', () => {
  it('always includes tests/policy (policy tests have no import edges; --changed never selects them)', () => {
    expect(extraTestPaths([])).toEqual(['tests/policy']);
    expect(extraTestPaths(['docs/notes.md'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['src/lib/format.ts'])).toEqual(['tests/policy']);
  });

  it('adds tests/db when a migration SQL file is staged (vitest cannot trace ?raw imports)', () => {
    expect(extraTestPaths(['src/db/migrations/0048_new_thing.sql'])).toEqual([
      'tests/policy',
      'tests/db',
    ]);
  });

  it('does NOT add tests/db for migrations.ts itself (a plain import; --changed already traces it)', () => {
    expect(extraTestPaths(['src/db/migrations.ts'])).toEqual(['tests/policy']);
  });

  it('ignores non-migration .sql files elsewhere in the tree', () => {
    expect(extraTestPaths(['scratch/query.sql'])).toEqual(['tests/policy']);
  });

  it('tolerates blank lines and duplicates from the git diff pipe', () => {
    expect(
      extraTestPaths(['', 'src/db/migrations/0002_seed_tax_rules.sql', 'src/db/migrations/0002_seed_tax_rules.sql', '']),
    ).toEqual(['tests/policy', 'tests/db']);
  });

  // v1.8.0 T12 (chip v171-12; code-review-I m11): the spec-timeout ratchet
  // (tests/e2e-harness/spec-timeouts.test.ts) reads e2e/*.spec.ts through
  // node:fs, so `vitest --changed` never selects it for a staged spec — a new
  // numeric timeout literal was caught only by the gate or CI.
  it('adds tests/e2e-harness when anything under e2e/ is staged (the ratchet reads the specs through node:fs)', () => {
    expect(extraTestPaths(['e2e/smoke.spec.ts'])).toEqual(['tests/policy', 'tests/e2e-harness']);
    expect(extraTestPaths(['e2e/boot-timeout.ts'])).toEqual(['tests/policy', 'tests/e2e-harness']);
    expect(extraTestPaths(['e2e/fixtures/seed.json'])).toEqual(['tests/policy', 'tests/e2e-harness']);
  });

  it('does NOT add tests/e2e-harness for a path outside e2e/ (anchored at the repo root; --changed already traces playwright.config.ts to its wiring pin)', () => {
    expect(extraTestPaths(['src/e2e/x.ts'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['docs/e2e/notes.md'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['e2e.md'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['tests/e2e-harness/identity.test.ts'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['playwright.config.ts'])).toEqual(['tests/policy']);
  });

  it('adds each suite once, in a fixed order, when a migration and several e2e paths are staged together', () => {
    expect(
      extraTestPaths(['e2e/smoke.spec.ts', 'src/db/migrations/0056_x.sql', 'e2e/flows.spec.ts', 'e2e/onboarding.spec.ts']),
    ).toEqual(['tests/policy', 'tests/db', 'tests/e2e-harness']);
  });

  // v1.8.0 T12 fix round (code review NIT): tests/config reads the shims README
  // and .claude/launch.json (readme-browser-shims.test.ts) and the workflows
  // (ci-workflow.test.ts, release-workflow.test.ts) through node:fs, so
  // `vitest --changed` selects nothing when only one of them is staged.
  it('adds tests/config when the shims README, .claude/launch.json or a workflow is staged (the config pins read them through node:fs)', () => {
    expect(extraTestPaths(['src/lib/browser-shims/README.md'])).toEqual(['tests/policy', 'tests/config']);
    expect(extraTestPaths(['.claude/launch.json'])).toEqual(['tests/policy', 'tests/config']);
    expect(extraTestPaths(['.github/workflows/release.yml'])).toEqual(['tests/policy', 'tests/config']);
    expect(extraTestPaths(['.github/workflows/test.yml'])).toEqual(['tests/policy', 'tests/config']);
  });

  it('does NOT add tests/config for a look-alike path (anchored at the repo root; exact file names)', () => {
    expect(extraTestPaths(['docs/src/lib/browser-shims/README.md'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['src/lib/browser-shims/README.md.bak'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['src/lib/browser-shims/index.ts'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['.claude/settings.json'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['x/.claude/launch.json'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['.claude/launch.json.orig'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['.github/dependabot.yml'])).toEqual(['tests/policy']);
    expect(extraTestPaths(['x/.github/workflows/release.yml'])).toEqual(['tests/policy']);
  });

  it('adds every mapped suite once, in a fixed order, when all of them are triggered together', () => {
    expect(
      extraTestPaths([
        '.github/workflows/release.yml',
        'e2e/smoke.spec.ts',
        '.claude/launch.json',
        'src/db/migrations/0056_x.sql',
        'src/lib/browser-shims/README.md',
      ]),
    ).toEqual(['tests/policy', 'tests/db', 'tests/e2e-harness', 'tests/config']);
  });
});
