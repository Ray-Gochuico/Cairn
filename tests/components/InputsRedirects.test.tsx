/**
 * W14 Task 15: the 12 migrated Inputs tabs become redirect stubs — old
 * bookmarks / muscle memory land on each entity's new home instead of a
 * dead tab (or a 404).
 *
 * Two layers:
 *  1. A static scan of App.tsx's inputs children (same source-scan idiom as
 *     cta-routes.test.ts) pins each retired tab path to its exact
 *     `<Navigate to="…" replace />` target, and pins the four kept Setup tabs.
 *  2. A functional createMemoryRouter run built FROM the same expected map
 *     proves the Navigate pattern actually lands (path + query intact).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Navigate } from 'react-router-dom';

const APP_TSX = resolve(__dirname, '../../src/App.tsx');

/** Old tab segment → new home (path may carry a ?manage query). */
const EXPECTED_REDIRECTS: Record<string, string> = {
  loans: '/loans',
  properties: '/property',
  'housing-payments': '/property',
  vehicles: '/vehicles',
  'vehicle-leases': '/vehicles',
  'equity-grants': '/equity-grants',
  goals: '/goals',
  'plans-529': '/goals',
  accounts: '/investments?manage=accounts',
  holdings: '/investments?manage=holdings',
  contributions: '/investments?manage=contributions',
  tickers: '/investments?manage=tickers',
};

const KEPT_TABS = ['household', 'persons', 'dependents', 'categories'];

function inputsChildrenBlock(): string {
  const src = readFileSync(APP_TSX, 'utf-8');
  const inputsIdx = src.search(/path:\s*'inputs'/);
  expect(inputsIdx).toBeGreaterThan(-1);
  const childrenKey = src.indexOf('children:', inputsIdx);
  const arrStart = src.indexOf('[', childrenKey);
  let depth = 0;
  for (let i = arrStart; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(arrStart, i + 1);
    }
  }
  throw new Error('unbalanced inputs children block');
}

describe('App.tsx inputs redirect stubs (static scan)', () => {
  it('each retired tab path is a <Navigate replace> to its new home', () => {
    const block = inputsChildrenBlock();
    for (const [tab, target] of Object.entries(EXPECTED_REDIRECTS)) {
      const re = new RegExp(
        `path:\\s*'${tab}',\\s*element:\\s*<Navigate\\s+to="${target.replace(/[?]/g, '\\?')}"\\s+replace\\s*/>`,
      );
      expect(block, `expected /inputs/${tab} to redirect to ${target}`).toMatch(re);
    }
  });

  it('the four Setup tabs remain real routes (no Navigate)', () => {
    const block = inputsChildrenBlock();
    for (const tab of KEPT_TABS) {
      const routeRe = new RegExp(`path:\\s*'${tab}',\\s*element:\\s*lazyRoute\\(`);
      expect(block, `expected /inputs/${tab} to stay a real tab`).toMatch(routeRe);
    }
  });
});

describe('inputs redirects land on the new homes (functional)', () => {
  function renderAt(initialPath: string) {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          children: [
            { path: 'loans', element: <div>LOANS PAGE</div> },
            { path: 'property', element: <div>PROPERTY PAGE</div> },
            { path: 'vehicles', element: <div>VEHICLES PAGE</div> },
            { path: 'equity-grants', element: <div>GRANTS PAGE</div> },
            { path: 'goals', element: <div>GOALS PAGE</div> },
            { path: 'investments', element: <div>INVESTMENTS PAGE</div> },
            {
              path: 'inputs',
              children: Object.entries(EXPECTED_REDIRECTS).map(([tab, target]) => ({
                path: tab,
                element: <Navigate to={target} replace />,
              })),
            },
          ],
        },
      ],
      { initialEntries: [initialPath] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it('/inputs/loans lands on the Loans page', () => {
    const router = renderAt('/inputs/loans');
    expect(screen.getByText('LOANS PAGE')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/loans');
  });

  it('/inputs/accounts lands on Investments with ?manage=accounts', () => {
    const router = renderAt('/inputs/accounts');
    expect(screen.getByText('INVESTMENTS PAGE')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/investments');
    expect(router.state.location.search).toBe('?manage=accounts');
  });

  it('/inputs/plans-529 lands on Goals', () => {
    const router = renderAt('/inputs/plans-529');
    expect(screen.getByText('GOALS PAGE')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/goals');
  });
});
