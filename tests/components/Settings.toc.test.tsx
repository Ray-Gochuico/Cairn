import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import Settings from '@/pages/Settings';

// Round-3 cleanup: TOC scroll-spy + focus handoff + expand-on-anchor.
// jsdom has no IntersectionObserver — stub it and capture the callback so
// the spy can be driven manually.
type IOCallback = (entries: Array<Partial<IntersectionObserverEntry>>) => void;
let ioCallback: IOCallback | null = null;

class FakeIntersectionObserver {
  constructor(cb: IOCallback) {
    ioCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Settings TOC — scroll-spy, focus handoff, expand-on-anchor', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    ioCallback = null;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    window.location.hash = '';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    window.location.hash = '';
    await db.close();
  });

  it('TOC click hands focus to the target section', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Settings /></MemoryRouter>);
    await user.click(screen.getByRole('link', { name: 'Data' }));
    const section = document.getElementById('data')!;
    expect(section).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(document.activeElement).toBe(section));
  });

  it('the scroll-spy marks the topmost intersecting section with aria-current', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(ioCallback).not.toBeNull();
    const data = document.getElementById('data')!;
    act(() => {
      ioCallback!([
        {
          target: data,
          isIntersecting: true,
          boundingClientRect: { top: 40 } as DOMRectReadOnly,
        },
      ]);
    });
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav.querySelector('a[href="#data"]')).toHaveAttribute('aria-current', 'location');
    expect(nav.querySelector('a[href="#privacy"]')).not.toHaveAttribute('aria-current');
  });

  it('anchoring the collapsed Advanced section expands it', async () => {
    window.location.hash = '#advanced';
    render(<MemoryRouter><Settings /></MemoryRouter>);
    // AdvancedSection is collapsed by default; the anchor must open it —
    // its expand toggle reads aria-expanded and the content (e.g. the
    // interest-threshold heading) mounts only when open.
    const toggle = await screen.findByRole('button', { name: /collapse advanced/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/interest-rate thresholds/i)).toBeInTheDocument();
  });
});
