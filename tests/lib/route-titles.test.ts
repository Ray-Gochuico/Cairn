import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentTitleFor, titleForPath, knownTitlePaths } from '@/lib/route-titles';
import { stripComments } from '../policy/source-walker';

describe('titleForPath', () => {
  it('maps every sidebar route', () => {
    expect(titleForPath('/')).toBe('Dashboard');
    expect(titleForPath('/net-worth')).toBe('Net Worth');
    expect(titleForPath('/investments')).toBe('Investments');
    expect(titleForPath('/loans')).toBe('Loans');
    expect(titleForPath('/property')).toBe('Property');
    expect(titleForPath('/vehicles')).toBe('Vehicles');
    expect(titleForPath('/equity-grants')).toBe('Equity Grants');
    expect(titleForPath('/spending')).toBe('Spending');
    expect(titleForPath('/spending/transactions')).toBe('Transactions');
    expect(titleForPath('/budget')).toBe('Budget');
    expect(titleForPath('/goals')).toBe('Goals');
    expect(titleForPath('/roadmap')).toBe('Roadmap');
    expect(titleForPath('/learn')).toBe('Learn');
    expect(titleForPath('/calculators')).toBe('Calculators');
    expect(titleForPath('/calculators/paycheck')).toBe('Paycheck calculator');
    expect(titleForPath('/calculators/backtest')).toBe('Historical Backtest');
    expect(titleForPath('/what-if')).toBe('What-If');
    expect(titleForPath('/settings')).toBe('Settings');
    expect(titleForPath('/monthly')).toBe('Monthly check-in');
    expect(titleForPath('/setup')).toBe('Setup');
    expect(titleForPath('/welcome')).toBe('Welcome');
  });
  it('maps inputs tabs with the section prefix', () => {
    expect(titleForPath('/inputs/accounts')).toBe('Inputs · Accounts');
    expect(titleForPath('/inputs/vehicle-leases')).toBe('Inputs · Vehicle Leases');
    expect(titleForPath('/inputs')).toBe('Inputs');
  });
  it('falls back: unknown leaf inherits the nearest known ancestor; unknown root is null', () => {
    expect(titleForPath('/inputs/some-future-tab')).toBe('Inputs');
    expect(titleForPath('/nope')).toBeNull();
    expect(titleForPath('/net-worth/')).toBe('Net Worth'); // trailing slash
  });
});

describe('documentTitleFor', () => {
  it('suffixes the app name and falls back to bare app name', () => {
    expect(documentTitleFor('/roadmap')).toBe('Roadmap · Cairn');
    expect(documentTitleFor('/nope')).toBe('Cairn');
  });
});

// ---------------------------------------------------------------------------
// R4 (Wave-5 ride-along): a REAL drift tripwire. Walk the route paths
// actually registered in App.tsx's createBrowserRouter literal and
// cross-check them against the TITLES table — a NEW route without an exact
// title entry fails here (titleForPath's ancestor fallback would otherwise
// mask it), and a TITLES entry whose route was deleted fails the reverse
// direction.
// ---------------------------------------------------------------------------

/**
 * Extract full route paths from App.tsx: brace/bracket-depth scan over the
 * comment-stripped source; `children:` pushes the enclosing object's path as
 * the prefix for nested `path:` entries. `path: '*'` (catch-all) and
 * `index: true` rows (no path token; they inherit the parent path) are
 * skipped. If App.tsx's routing shape ever outgrows this scanner, the
 * assertions below fail loudly — fix the scanner, don't delete the test.
 */
function extractAppRoutePaths(): string[] {
  const src = stripComments(readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8'));
  const out: string[] = [];
  const frames: { pushDepth: number; prefix: string }[] = [];
  const lastPathAtDepth = new Map<number, string>();
  let depth = 0;
  const re = /\{|\}|\[|\]|path:\s*'([^']*)'|children:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    if (tok === '{' || tok === '[') {
      depth += 1;
      continue;
    }
    if (tok === '}' || tok === ']') {
      depth -= 1;
      while (frames.length > 0 && depth <= frames[frames.length - 1].pushDepth) frames.pop();
      continue;
    }
    if (tok === 'children:') {
      const parent = lastPathAtDepth.get(depth);
      if (parent !== undefined) frames.push({ pushDepth: depth, prefix: parent });
      continue;
    }
    const seg = m[1];
    if (seg === undefined) continue;
    const prefix = frames.length > 0 ? frames[frames.length - 1].prefix : '';
    const full = seg.startsWith('/') ? seg : prefix === '/' ? `/${seg}` : `${prefix}/${seg}`;
    lastPathAtDepth.set(depth, full);
    if (seg !== '*') out.push(full);
  }
  return out;
}

describe('App.tsx ↔ TITLES parity (route-title drift tripwire)', () => {
  it('sanity: the scanner sees the router (a broken regex must not vacuously pass)', () => {
    const routes = extractAppRoutePaths();
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('/');
    expect(routes).toContain('/inputs/accounts'); // nested prefix join works
  });

  it('every route registered in App.tsx has an EXACT title entry', () => {
    const titled = new Set(knownTitlePaths());
    const untitled = extractAppRoutePaths().filter((p) => !titled.has(p));
    expect(
      untitled,
      `Route(s) registered in App.tsx without a title entry: ${untitled.join(', ')}\n` +
        'Add the route to TITLES in src/lib/route-titles.ts in the same PR.',
    ).toEqual([]);
  });

  it('no stale TITLES entries: every titled path is still a registered route', () => {
    const routes = new Set(extractAppRoutePaths());
    const stale = knownTitlePaths().filter((p) => !routes.has(p));
    expect(
      stale,
      `TITLES entr(ies) whose route no longer exists in App.tsx: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
