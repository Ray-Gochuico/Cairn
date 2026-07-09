import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import Settings from '@/pages/Settings';

// The DB is set up so that later slices (which make the real sections load
// stores in useEffect) keep this test green without modification.
describe('Settings page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the six section cards', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    for (const title of ['Sidebar', 'Notifications', 'Market data', 'Data', 'Chart colors', 'Statements']) {
      // Each title now renders both as a nav-rail anchor and a section h2;
      // assert on the heading to disambiguate from the TOC link.
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  // L1.3 — the difficulty toggle is retired end-to-end. The 4-set is a fixed
  // 2 Beginner + 2 Advanced (D5), so the per-question difficulty PREFERENCE no
  // longer has a job. Settings no longer mounts the Learning card / its toggle.
  it('has no Learning difficulty toggle (retired with the 4-set)', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Mixed' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Learning' })).toBeNull();
  });

  it('renders each section title as a real level-2 heading', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    for (const title of [
      'Getting started', 'Appearance', 'Privacy & data', 'Sidebar',
      'Notifications', 'Market data', 'Data', 'Chart colors',
      'Statements', 'Updates', 'Advanced', 'Disclosures',
    ]) {
      expect(h2s).toContain(title);
    }
    expect(h2s).toHaveLength(12);
  });

  it('renders a sticky section table-of-contents with anchors to every section', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const ids = [
      'getting-started', 'appearance', 'privacy', 'sidebar', 'notifications',
      'market-data', 'data', 'chart-colors', 'statements', 'updates',
      'advanced', 'disclosures',
    ];
    for (const id of ids) {
      // A nav anchor targets this id, and the target is a real <section>.
      expect(nav.querySelector(`a[href="#${id}"]`)).not.toBeNull();
      const target = document.getElementById(id);
      expect(target).not.toBeNull();
      expect(target?.tagName.toLowerCase()).toBe('section');
    }
  });

  it('has direction-free network copy (no "above")', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const privacy = document.getElementById('privacy');
    expect(privacy).not.toBeNull();
    expect(privacy?.textContent).not.toMatch(/above/);
  });

  it('collapses the outbound network essay until its summary is toggled', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const essay = screen.getByText(/Cairn makes exactly two outbound calls/);
    expect(essay).not.toBeVisible();
    const summary = screen.getByText(/About outbound network calls/i);
    fireEvent.click(summary);
    expect(essay).toBeVisible();
  });
});
