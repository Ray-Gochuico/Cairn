import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the v1.0 ship-blocker where Roadmap "next step"
 * CTAs pointed at bare top-level paths (e.g. `/accounts`) that have no
 * matching route — the real data-entry surfaces live under `/inputs/*`
 * — so 25 of 29 CTAs fell through the `*` → NotFound route. This broke
 * the flagship "what should I do next?" flow from both the Roadmap page
 * and the Dashboard's "Suggested next step" card.
 *
 * Strategy: statically scan every roadmap rule source for `href: '...'`
 * literals (catches every href a rule can emit, across all branches,
 * without having to construct a representative context for each), then
 * assert each one resolves to a real route declared in src/App.tsx. The
 * valid-path set is built by parsing App.tsx's route table so the test
 * tracks the real router rather than a hand-maintained mirror.
 */

const SRC = resolve(__dirname, '../../../src');
const RULES_DIR = resolve(SRC, 'domain/roadmap/rules');
const APP_TSX = resolve(SRC, 'App.tsx');

/**
 * Parse the absolute navigable paths out of src/App.tsx. The router is a
 * `createBrowserRouter([...])` config with a top-level `path: '/'` whose
 * children are top-level routes, and an `inputs` child route whose own
 * children are the data-entry tabs. We reconstruct the real route tree:
 *   - '/' (index)
 *   - '/<segment>' for each child of the '/' route (top-level routes)
 *   - '/inputs' and '/inputs/<segment>' for each child of the inputs route
 *   - '/setup' (sibling of '/')
 *
 * Crucially, an inputs-tab segment (e.g. `accounts`) resolves ONLY as
 * `/inputs/accounts`, NOT as a bare `/accounts` — that distinction is the
 * whole point of this guard, so we must respect the nesting rather than
 * flatten every `path:` literal into both forms.
 *
 * We track nesting by walking the source brace-by-brace and noting when we
 * enter the `path: 'inputs'` object's `children: [` block. Path literals
 * seen while inside that block are inputs tabs; everything else under '/'
 * is a top-level route.
 */
function validRoutePaths(): Set<string> {
  const src = readFileSync(APP_TSX, 'utf-8');
  const paths = new Set<string>();
  paths.add('/'); // index route under '/'
  paths.add('/setup');

  // Find the `path: 'inputs'` route object and isolate its `children: [ ... ]`
  // array text, so we can classify each tab segment as nested under /inputs.
  const inputsIdx = src.search(/path:\s*'inputs'/);
  let inputsChildrenBlock = '';
  if (inputsIdx !== -1) {
    const childrenKey = src.indexOf('children:', inputsIdx);
    const arrStart = src.indexOf('[', childrenKey);
    // Walk brackets to find the matching close of the inputs children array.
    let depth = 0;
    let end = arrStart;
    for (let i = arrStart; i < src.length; i++) {
      const ch = src[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    inputsChildrenBlock = src.slice(arrStart, end + 1);
    paths.add('/inputs');
  }

  for (const m of inputsChildrenBlock.matchAll(/path:\s*'([^']*)'/g)) {
    const tab = m[1];
    if (tab === '' || tab === '*') continue;
    paths.add(`/inputs/${tab}`);
  }

  // Top-level routes: scan the source with the inputs children block
  // removed, so a segment that exists BOTH at top level and as an inputs
  // tab (e.g. `loans`, `vehicles`, `goals`, `equity-grants`) still gets its
  // top-level `/loans` form added here. Classifying by segment value alone
  // would wrongly drop those.
  const srcWithoutInputsChildren = inputsChildrenBlock
    ? src.replace(inputsChildrenBlock, '')
    : src;
  for (const m of srcWithoutInputsChildren.matchAll(/path:\s*'([^']*)'/g)) {
    const p = m[1];
    if (p === '' || p === '*' || p === 'inputs' || p === '/setup') continue;
    paths.add(`/${p}`);
  }

  return paths;
}

function collectCtaHrefs(): { href: string; file: string }[] {
  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith('.ts'));
  const hrefs: { href: string; file: string }[] = [];
  for (const f of files) {
    const src = readFileSync(resolve(RULES_DIR, f), 'utf-8');
    for (const m of src.matchAll(/href:\s*'([^']*)'/g)) {
      hrefs.push({ href: m[1], file: f });
    }
  }
  return hrefs;
}

describe('roadmap CTA hrefs resolve to real routes', () => {
  it('finds CTA hrefs to check (sanity: the scan is wired up)', () => {
    const hrefs = collectCtaHrefs();
    // There are 29 CTA hrefs across the rule files today; assert we found
    // a non-trivial number so a refactor that moves hrefs out of these
    // files trips this guard instead of silently passing.
    expect(hrefs.length).toBeGreaterThanOrEqual(25);
  });

  it('builds a non-empty valid-route set from App.tsx', () => {
    const valid = validRoutePaths();
    // Spot-check a few routes we know exist so a parser regression fails
    // here rather than producing false negatives below.
    expect(valid.has('/roadmap')).toBe(true);
    expect(valid.has('/inputs/accounts')).toBe(true);
    expect(valid.has('/inputs/household')).toBe(true);
    expect(valid.has('/inputs/contributions')).toBe(true);
    expect(valid.has('/loans')).toBe(true);
    expect(valid.has('/spending')).toBe(true);
  });

  it('every roadmap CTA href points at a route that exists', () => {
    const valid = validRoutePaths();
    const hrefs = collectCtaHrefs();

    const broken = hrefs.filter(({ href }) => !valid.has(href));

    expect(
      broken,
      `These roadmap CTA hrefs do not resolve to any route in App.tsx ` +
        `(they would fall through to NotFound):\n` +
        broken.map(({ href, file }) => `  ${href}  (${file})`).join('\n'),
    ).toEqual([]);
  });
});
