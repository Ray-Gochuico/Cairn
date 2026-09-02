import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../policy/source-walker';

/**
 * W4 review (MINOR 12): src/main.tsx carries two D-S7 guarantees — no monthly
 * redirect and no native notification while exploring — and neither had a pin.
 * `bootstrap()` runs on import and owns the ReactDOM root, so no test can call
 * it; both guard-removal mutants survived the whole suite.
 *
 * This is a SOURCE pin, deliberately: it asserts the two guards are wired at
 * their call sites, which is the property the mutants broke. The behavior they
 * guard is covered where it is testable (tests/db/init-explore.test.ts pins the
 * boot branch itself).
 */
const MAIN = stripComments(
  readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.tsx'), 'utf8'),
);

describe('main.tsx boot-time explore guards (D-S7)', () => {
  it('reads the explore flag at boot', () => {
    expect(MAIN).toContain("import { isExploreMode } from './lib/explore-mode';");
  });

  it('skips the monthly redirect while exploring', () => {
    // `if (!isExploreMode()) { … maybeRedirectToMonthly( … ) }` — an
    // `if (true)` mutant, or hoisting the call out of the block, fails here.
    expect(MAIN).toMatch(
      /if \(!isExploreMode\(\)\) \{[^{}]*\{[^{}]*maybeRedirectToMonthly\(/,
    );
    // …and there is exactly ONE call site, so no unguarded second path exists.
    expect(MAIN.match(/maybeRedirectToMonthly\(/g)).toHaveLength(1);
  });

  it('skips the native notification while exploring', () => {
    // The IIFE early-returns before the settings read / permission prompt.
    expect(MAIN).toMatch(
      /void \(async \(\) => \{\s*if \(isExploreMode\(\)\) return;/,
    );
    expect(MAIN.match(/sendNotification\(/g)).toHaveLength(1);
  });
});
