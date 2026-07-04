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
});
