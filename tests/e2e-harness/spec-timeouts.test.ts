// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectSourceFiles } from '../policy/source-walker';

const E2E = path.resolve(__dirname, '..', '..', 'e2e');
// e2e/**/*.spec.ts, RECURSIVE (tests/policy/source-walker.ts:12-30) — a spec
// placed under a subdirectory is scanned too, so the ratchet cannot be dodged
// by moving a file (R2-6). Absolute paths; reported relative to e2e/.
let specs: string[] = [];
beforeAll(async () => {
  specs = (await collectSourceFiles(E2E, ['.spec.ts'])).sort();
});
/** Keywords after which a `/` opens a regex literal rather than dividing. */
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Review I-m1/I-m5: blank the COMMENTS of a TS source (newlines kept) and
 * nothing else. tests/policy/source-walker.ts's stripComments starts a comment
 * at any `//` or `/*`, even inside a 'http://…' URL, a route glob or a regex
 * such as /\/setup\//, and that hid the rest of the line (or of the file) from
 * this ratchet. This scanner walks strings ('…', "…"), template literals
 * (`…${ … }…`, nesting) and regex literals (a `/` where an operand may start:
 * after punctuation, a keyword or the start — the standard heuristic) and
 * leaves their bodies intact. When the heuristic misreads, it errs toward
 * SHOWING text (a stricter ratchet), except for a regex literal written
 * directly after `)` or `]`, which reads as division.
 */
function maskComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let prev: { kind: 'start' | 'punct' | 'word' | 'value'; text: string } = { kind: 'start', text: '' };
  let depth = 0; // { } depth in code
  const templates: number[] = []; // the depth each open `${` returns at
  const regexMayStart = () =>
    prev.kind === 'start' || prev.kind === 'punct' || (prev.kind === 'word' && REGEX_AFTER_WORD.has(prev.text));

  const quoted = (from: number, q: string): number => {
    let j = from + 1;
    while (j < n) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === q) return j + 1;
      else if (src[j] === '\n') return j; // unterminated: stop at the line end
      else j += 1;
    }
    return n;
  };
  const template = (from: number): number => {
    let j = from;
    while (j < n) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '`') {
        prev = { kind: 'value', text: '`' };
        return j + 1;
      } else if (src[j] === '$' && src[j + 1] === '{') {
        depth += 1;
        templates.push(depth);
        prev = { kind: 'punct', text: '{' };
        return j + 2;
      } else j += 1;
    }
    return n;
  };
  const regex = (from: number): number => {
    let j = from + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') j += 2;
      else if (c === '\n') return j; // a regex never spans lines: it was not one
      else if (inClass) {
        if (c === ']') inClass = false;
        j += 1;
      } else if (c === '[') {
        inClass = true;
        j += 1;
      } else if (c === '/') {
        j += 1;
        while (j < n && /[a-z]/i.test(src[j])) j += 1; // flags
        return j;
      } else j += 1;
    }
    return n;
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const eol = src.indexOf('\n', i);
      const end = eol === -1 ? n : eol;
      blank(i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      i = quoted(i, c);
      prev = { kind: 'value', text: c };
    } else if (c === '`') {
      i = template(i + 1);
    } else if (c === '/' && regexMayStart()) {
      i = regex(i);
      prev = { kind: 'value', text: '/' };
    } else if (c === '{') {
      depth += 1;
      prev = { kind: 'punct', text: c };
      i += 1;
    } else if (c === '}') {
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        templates.pop();
        depth -= 1;
        i = template(i + 1);
      } else {
        depth -= 1;
        prev = { kind: 'punct', text: c };
        i += 1;
      }
    } else if (/\s/.test(c)) {
      i += 1;
    } else if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      prev = /^\d/.test(word) ? { kind: 'value', text: word } : { kind: 'word', text: word };
      i = j;
    } else if (c === ')' || c === ']') {
      prev = { kind: 'value', text: c };
      i += 1;
    } else {
      prev = { kind: 'punct', text: c };
      i += 1;
    }
  }
  return out.join('');
}

/** The source with its comments blanked — what the ratchet scans. */
const scannable = (src: string) => maskComments(src);
const read = (f: string) => scannable(readFileSync(f, 'utf8'));
const label = (f: string) => path.relative(E2E, f);

/**
 * The two shapes 971d0850 carried (`timeout: <n>`, `test.setTimeout(<n>)`) plus
 * the detours around them: `page.waitForTimeout(<n>)` (a sleep, never a wait),
 * `test.slow()` (3× the budget, outside the policy) and a hoisted numeric
 * constant whose name says TIMEOUT or WAIT (`const BOOT_WAIT = 45_000`).
 * Review I-m4 appended (the first five alternatives are unchanged): every
 * `set…Timeout(<n>)` — `setDefaultTimeout`, `setDefaultNavigationTimeout`,
 * `test.info().setTimeout`, `testInfo.setTimeout`; any option key with timeout
 * in its name (`actionTimeout: <n>`, `navigationTimeout: <n>`, `timeout : <n>`,
 * `timeoutMs: <n>`); the spaced calls; and camelCase names (`const bootWait`,
 * `let navTimeout`). Accepted gaps, stated: a numeric constant whose name says
 * neither timeout nor wait (`const BOOT = 45_000`), a number reaching a timeout
 * through such a constant, and the non-spec helpers under e2e/ (not scanned:
 * load-guard.ts and boot-timeout.ts hold the policy's own constants) — review
 * catches those.
 */
const OFFENDER =
  /\btimeout:\s*\d[\d_]*|\btest\.setTimeout\(\s*\d[\d_]*|\bwaitForTimeout\(\s*\d|\btest\.slow\(|\bconst\s+\w*(?:TIMEOUT|WAIT)\w*\s*=\s*\d|\bset(?:Default)?(?:Navigation)?Timeout\s*\(\s*\d[\d_]*|\b\w*[Tt]imeout\w*\s*:\s*\d[\d_]*|\bwaitForTimeout\s*\(\s*\d[\d_]*|\btest\.slow\s*\(|\b(?:const|let|var)\s+\w*(?:TIMEOUT|WAIT|[Tt]imeout|[Ww]ait)\w*\s*=\s*\d[\d_]*/g;

/**
 * 49 expect-option sites + the explore override at 971d0850. Raise freely as
 * specs grow; lower only with a reason in the commit (a wait that was deleted,
 * not a literal that came back).
 */
const BOOT_WAIT_FLOOR = 50;

/** Every offending match in one spec's source (comments excluded). */
function offendersIn(src: string): string[] {
  return [...scannable(src).matchAll(OFFENDER)].map((m) => m[0]);
}

/** bootTimeout() call sites in one spec's source (comments excluded). */
function bootWaitSites(src: string): number {
  return (scannable(src).match(/\bbootTimeout\(\)/g) ?? []).length;
}

describe('e2e specs — every wait follows the load policy (v1.7.1 A-6 ratchet)', () => {
  it('walks real specs', () => {
    expect(specs.length).toBeGreaterThanOrEqual(6);
  });

  it('no numeric timeout literal in any spec: no `timeout: <n>`, `test.setTimeout(<n>)`, `waitForTimeout(<n>)`, `test.slow()` or hoisted `const *TIMEOUT/*WAIT = <n>` — use bootTimeout()', () => {
    const offenders: string[] = [];
    for (const f of specs) {
      for (const m of offendersIn(readFileSync(f, 'utf8'))) {
        offenders.push(`${label(f)}: ${m}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every spec that waits imports bootTimeout from ./boot-timeout, and the suite keeps at least the wait sites it had', () => {
    let sites = 0;
    for (const f of specs) {
      const src = read(f);
      const n = bootWaitSites(readFileSync(f, 'utf8'));
      if (n > 0) expect(src, label(f)).toMatch(/import \{[^}]*\bbootTimeout\b[^}]*\} from '\.\/boot-timeout';/);
      sites += n;
    }
    expect(sites).toBeGreaterThanOrEqual(BOOT_WAIT_FLOOR);
  });
});

// Review I-m1/I-m5: the comment mask must know strings, template literals and
// regex literals, or a `//` or `/*` inside one hides the rest of the line (or
// the file) from the ratchet and from the floor count. Planted sentinels.
describe('the ratchet scans code, not comments — a // or /* inside a string, template or regex hides nothing', () => {
  it('flags a literal after a URL, a glob, a regex or a template that contains // or /*', () => {
    expect(offendersIn(`await page.goto('http://localhost:1522/x', { timeout: 30_000 });`)).toEqual(['timeout: 30_000']);
    expect(offendersIn(`await page.goto("http://localhost:1522/x", { timeout: 30_000 });`)).toEqual(['timeout: 30_000']);
    expect(offendersIn('await page.goto(`http://localhost:${port}/x`, { timeout: 30_000 });')).toEqual(['timeout: 30_000']);
    expect(
      offendersIn(`await page.route('**/*.json', (r) => r.continue());\nawait expect(x).toBeVisible({ timeout: 45_000 });`),
    ).toEqual(['timeout: 45_000']);
    expect(offendersIn(`await expect(page).toHaveURL(/\\/setup\\//, { timeout: 45_000 });`)).toEqual(['timeout: 45_000']);
    expect(offendersIn(`const re = /[/]x/; await y({ timeout: 45_000 });`)).toEqual(['timeout: 45_000']);
    expect(offendersIn(`const half = total / 2; await y({ timeout: 45_000 }); // half / 2`)).toEqual(['timeout: 45_000']);
  });

  it('still ignores a literal that sits in a real comment', () => {
    expect(offendersIn(`// was { timeout: 30_000 } before A-6`)).toEqual([]);
    expect(offendersIn(`/* was { timeout: 30_000 } */ await x();`)).toEqual([]);
    expect(offendersIn(`/**\n * was { timeout: 30_000 }\n */\nawait x();`)).toEqual([]);
    expect(offendersIn(`const u = 'http://x/'; // was { timeout: 30_000 }`)).toEqual([]);
    expect(offendersIn('const u = `a${b}c`; /* timeout: 30_000 */')).toEqual([]);
  });

  it('counts a bootTimeout() wait that follows a URL toward the floor (and none inside a comment)', () => {
    expect(bootWaitSites(`await page.goto('http://localhost:1522/x', { timeout: bootTimeout() });`)).toBe(1);
    expect(bootWaitSites(`// { timeout: bootTimeout() }`)).toBe(0);
  });
});

// Review I-m4: every Playwright way to set a wait with a number, one sentinel
// each. The 971d0850 shapes first (unchanged), then the ones the review listed.
describe('the ratchet refuses every numeric timeout shape, and none of the bootTimeout() forms', () => {
  it('the plan shapes: timeout: <n>, test.setTimeout(<n>), waitForTimeout(<n>), test.slow(), const *TIMEOUT/*WAIT = <n>', () => {
    expect(offendersIn(`await x({ timeout: 30_000 });`)).toEqual(['timeout: 30_000']);
    expect(offendersIn(`test.setTimeout(150_000);`)).toEqual(['test.setTimeout(150_000']);
    expect(offendersIn(`await page.waitForTimeout(500);`)).toEqual(['waitForTimeout(5']);
    expect(offendersIn(`test.slow();`)).toEqual(['test.slow(']);
    expect(offendersIn(`const BOOT_WAIT = 45_000;`)).toEqual(['const BOOT_WAIT = 4']);
  });

  it('setDefaultTimeout / setDefaultNavigationTimeout / test.info().setTimeout / testInfo.setTimeout with a number', () => {
    expect(offendersIn(`page.setDefaultTimeout(60_000);`)).toEqual(['setDefaultTimeout(60_000']);
    expect(offendersIn(`context.setDefaultNavigationTimeout(60000);`)).toEqual(['setDefaultNavigationTimeout(60000']);
    expect(offendersIn(`test.info().setTimeout(60_000);`)).toEqual(['setTimeout(60_000']);
    expect(offendersIn(`testInfo.setTimeout(60_000);`)).toEqual(['setTimeout(60_000']);
  });

  it('any *timeout* option key with a number: actionTimeout, navigationTimeout, `timeout :`, timeoutMs', () => {
    expect(offendersIn(`test.use({ actionTimeout: 10_000 });`)).toEqual(['actionTimeout: 10_000']);
    expect(offendersIn(`test.use({ navigationTimeout: 30_000 });`)).toEqual(['navigationTimeout: 30_000']);
    expect(offendersIn(`await x({ timeout : 30_000 });`)).toEqual(['timeout : 30_000']);
    expect(offendersIn(`await x({ timeoutMs: 30_000 });`)).toEqual(['timeoutMs: 30_000']);
  });

  it('spaced calls and camelCase names: waitForTimeout (<n>), test.slow (), const bootWait / let navTimeout = <n>', () => {
    expect(offendersIn(`await page.waitForTimeout (500);`)).toEqual(['waitForTimeout (500']);
    expect(offendersIn(`test.slow ();`)).toEqual(['test.slow (']);
    expect(offendersIn(`const bootWait = 45_000;`)).toEqual(['const bootWait = 45_000']);
    expect(offendersIn(`let navTimeout = 45_000;`)).toEqual(['let navTimeout = 45_000']);
  });

  it('leaves the policy forms and plain JavaScript timers alone', () => {
    expect(offendersIn(`await expect(x).toBeVisible({ timeout: bootTimeout() });`)).toEqual([]);
    expect(offendersIn(`test.setTimeout(bootTimeout() * 5);`)).toEqual([]);
    expect(offendersIn(`setTimeout(() => done(), 100);`)).toEqual([]);
    expect(offendersIn(`const waitForBoot = bootTimeout();`)).toEqual([]);
    expect(offendersIn(`expect.configure({ soft: true });`)).toEqual([]);
  });
});
