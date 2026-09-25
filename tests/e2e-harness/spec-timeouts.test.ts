// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectSourceFiles, stripComments } from '../policy/source-walker';

const E2E = path.resolve(__dirname, '..', '..', 'e2e');
// e2e/**/*.spec.ts, RECURSIVE (tests/policy/source-walker.ts:12-30) — a spec
// placed under a subdirectory is scanned too, so the ratchet cannot be dodged
// by moving a file (R2-6). Absolute paths; reported relative to e2e/.
let specs: string[] = [];
beforeAll(async () => {
  specs = (await collectSourceFiles(E2E, ['.spec.ts'])).sort();
});
const read = (f: string) => stripComments(readFileSync(f, 'utf8'));
const label = (f: string) => path.relative(E2E, f);

/**
 * The two shapes 971d0850 carried (`timeout: <n>`, `test.setTimeout(<n>)`) plus
 * the detours around them: `page.waitForTimeout(<n>)` (a sleep, never a wait),
 * `test.slow()` (3× the budget, outside the policy) and a hoisted numeric
 * constant whose name says TIMEOUT or WAIT (`const BOOT_WAIT = 45_000`).
 * Accepted gap, stated: a numeric constant named without TIMEOUT/WAIT, and
 * `expect.configure({ timeout })` with such a constant — review catches those.
 */
const OFFENDER =
  /\btimeout:\s*\d[\d_]*|\btest\.setTimeout\(\s*\d[\d_]*|\bwaitForTimeout\(\s*\d|\btest\.slow\(|\bconst\s+\w*(?:TIMEOUT|WAIT)\w*\s*=\s*\d/g;

/**
 * 49 expect-option sites + the explore override at 971d0850. Raise freely as
 * specs grow; lower only with a reason in the commit (a wait that was deleted,
 * not a literal that came back).
 */
const BOOT_WAIT_FLOOR = 50;

describe('e2e specs — every wait follows the load policy (v1.7.1 A-6 ratchet)', () => {
  it('walks real specs', () => {
    expect(specs.length).toBeGreaterThanOrEqual(6);
  });

  it('no numeric timeout literal in any spec: no `timeout: <n>`, `test.setTimeout(<n>)`, `waitForTimeout(<n>)`, `test.slow()` or hoisted `const *TIMEOUT/*WAIT = <n>` — use bootTimeout()', () => {
    const offenders: string[] = [];
    for (const f of specs) {
      for (const m of read(f).matchAll(OFFENDER)) {
        offenders.push(`${label(f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every spec that waits imports bootTimeout from ./boot-timeout, and the suite keeps at least the wait sites it had', () => {
    let sites = 0;
    for (const f of specs) {
      const src = read(f);
      const n = (src.match(/\bbootTimeout\(\)/g) ?? []).length;
      if (n > 0) expect(src, label(f)).toMatch(/import \{[^}]*\bbootTimeout\b[^}]*\} from '\.\/boot-timeout';/);
      sites += n;
    }
    expect(sites).toBeGreaterThanOrEqual(BOOT_WAIT_FLOOR);
  });
});
