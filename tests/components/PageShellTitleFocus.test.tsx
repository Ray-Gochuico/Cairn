import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import PageShell from '@/components/layout/PageShell';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSettingsStore } from '@/stores/settings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePersonsStore } from '@/stores/persons-store';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

/** Opaque to isExploreMode() — only presence matters (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

// Wave-4 a11y: PageShell owns the per-route document.title and the
// focus-main-on-navigation behavior (SPA route changes are silent for
// AT otherwise), plus the Sidebar's Primary nav landmark.

function renderAt(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <PageShell />,
        children: [
          { index: true, element: <div>home page</div> },
          { path: 'roadmap', element: <div>roadmap page</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('PageShell route title + focus', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    // Same store-reset prelude as tests/components/Sidebar.test.tsx.
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    await db.close();
  });

  it('sets document.title for the current route without stealing initial focus', () => {
    renderAt('/');
    expect(document.title).toBe('Dashboard · Cairn');
    expect(document.getElementById('main')).not.toHaveFocus();
  });

  it('on navigation: updates the title and moves focus to <main>', async () => {
    const user = userEvent.setup();
    renderAt('/');
    // Sidebar renders the real nav; use its Roadmap link.
    await user.click(screen.getByRole('link', { name: /roadmap/i }));
    expect(document.title).toBe('Roadmap · Cairn');
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('exposes the primary navigation landmark', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  // R3 (Wave-5 ride-along): the focus-main effect is keyed on
  // location.pathname — a SAME-path navigation that only changes the query
  // string (e.g. Investments' transient ?view=p1 focus param) must NOT yank
  // focus away from whatever control the user is on.
  it('same-path query navigation (?view=p1) does not steal focus to <main>', async () => {
    const router = renderAt('/');
    const link = screen.getByRole('link', { name: /roadmap/i });
    link.focus();
    expect(link).toHaveFocus();
    await act(async () => {
      await router.navigate('/?view=p1');
    });
    expect(document.getElementById('main')).not.toHaveFocus();
    expect(link).toHaveFocus(); // user's position untouched
  });

  // W4: the sample banner is app-level chrome owned by the shell, and the
  // window title carries the ' — Sample' suffix so the OS switcher is honest.
  it('while exploring: renders the sample-data note and suffixes the window title', () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    renderAt('/');
    expect(screen.getByRole('note', { name: 'Sample data notice' })).toBeInTheDocument();
    expect(document.title).toBe('Dashboard · Cairn — Sample');
  });

  it('without the flag: no note, no title suffix (production first-run is untouched)', () => {
    renderAt('/');
    expect(screen.queryByRole('note', { name: 'Sample data notice' })).toBeNull();
    expect(document.title).toBe('Dashboard · Cairn');
  });
});
