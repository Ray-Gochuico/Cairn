import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DisclosuresSection } from '@/components/settings/DisclosuresSection';
import { DISCLOSURES } from '@/legal/disclosures';

/**
 * Legal M1/M2 coverage — the in-app home for the consented disclosures.
 *
 * The app points users at "Settings → Disclosures" (WhatIf footnote, the
 * backtest disclosure body). This section is the read-only landing for those
 * four documents, plus the Yahoo non-affiliation line (M2) and a pointer to
 * the bundled third-party license attributions (H1).
 *
 * It renders the SAME consented BODIES as DisclosureModal via react-markdown,
 * read-only — there is no checkbox / accept affordance here.
 */
describe('Settings → Disclosures section (Legal M1/M2)', () => {
  const renderSection = () =>
    render(
      <MemoryRouter>
        <DisclosuresSection />
      </MemoryRouter>,
    );

  it('renders a Disclosures section title', () => {
    renderSection();
    // The shadcn CardTitle renders a styled <div>, not a heading role (matching
    // every other Settings section), so assert on text.
    expect(screen.getByText('Disclosures')).toBeInTheDocument();
  });

  it('renders all five consented documents, each in its own viewer with its title as a heading', () => {
    renderSection();
    const viewers = screen.getAllByTestId('disclosure-viewer');
    expect(viewers).toHaveLength(5);
    // Each DISCLOSURES doc surfaces its own title as the viewer's <h3>. We scope
    // to the heading because several bodies OPEN with the same bold line (e.g.
    // "**About the Learning feature**"), so a bare getByText would be ambiguous.
    for (const doc of Object.values(DISCLOSURES)) {
      const headingMatches = viewers
        .map((v) => within(v).queryByRole('heading', { name: doc.title }))
        .filter((el): el is HTMLElement => el !== null);
      expect(headingMatches, `expected a viewer heading for "${doc.title}"`).toHaveLength(1);
    }
    // Sanity: exactly the five we expect.
    expect(Object.keys(DISCLOSURES)).toHaveLength(5);
  });

  it('shows each document version (exact text — the R3 what-changed notes also begin "Version x.y …")', () => {
    renderSection();
    // app_wide=1.5, roadmap=1.0, learning=1.0, backtest=1.5, interview=1.1.
    // Exact-string matches on purpose: two documents are now 1.5, and each
    // note's first sentence ("Version 1.5 adds…", "Version 1.5 changes only…",
    // "Version 1.1 adds…") would substring-match a regex.
    expect(screen.getAllByText('Version 1.5')).toHaveLength(2); // app_wide + backtest (R3 bump)
    expect(screen.getAllByText('Version 1.1')).toHaveLength(1); // interview
    expect(screen.getAllByText('Version 1.0')).toHaveLength(2); // roadmap + learning
    expect(screen.queryByText('Version 1.4')).toBeNull(); // the backtest bump landed
  });

  it('renders each document body as Markdown (bold → <strong>, no literal asterisks)', () => {
    renderSection();
    // app_wide body opens with a **bold** sentence; after react-markdown the
    // asterisks are gone and a <strong> exists in that doc's rendered body.
    const bodies = screen.getAllByTestId('disclosure-viewer-body');
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(body.textContent).not.toMatch(/\*\*/);
    }
    // At least one body parsed bold into a <strong>.
    expect(bodies.some((b) => b.querySelector('strong'))).toBe(true);
  });

  it('renders the app_wide disclaimer body text (the consented copy, read-only)', () => {
    renderSection();
    // A distinctive phrase from APP_WIDE_TEXT_v1_5.
    expect(
      screen.getByText(/educational and personal-tracking tool/i),
    ).toBeInTheDocument();
  });

  it('includes the Yahoo non-affiliation line (Legal M2)', () => {
    renderSection();
    const yahoo = screen.getByText(
      /not affiliated with, endorsed by, or sponsored by Yahoo/i,
    );
    expect(yahoo).toBeInTheDocument();
    expect(yahoo.textContent).toMatch(/trademark of its respective owner/i);
  });

  it('has NO accept/continue affordance — it is read-only', () => {
    renderSection();
    // The modal has a "Continue" accept button + acceptance checkbox; the
    // read-only section must not.
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('points to the bundled third-party license attributions (Legal H1)', () => {
    renderSection();
    // The section is the in-app home for the third-party license file: it names
    // the bundled file and offers a button to view the attributions.
    expect(
      screen.getByText(/THIRD-PARTY-LICENSES\.md/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view third-party licenses/i }),
    ).toBeInTheDocument();
  });

  it('renders the app_wide document inside its own viewer with its version', () => {
    renderSection();
    // Co-locate title + version inside one viewer so the version unambiguously
    // belongs to the doc above it.
    const appWide = screen.getByText(DISCLOSURES.app_wide.title).closest(
      '[data-testid="disclosure-viewer"]',
    );
    expect(appWide).not.toBeNull();
    expect(within(appWide as HTMLElement).getByText('Version 1.5')).toBeInTheDocument();
  });

  describe('what-changed notes (R3, v1.7.0 — the diff has a permanent, read-only home)', () => {
    const viewerOf = (title: string) => {
      const viewer = screen
        .getAllByTestId('disclosure-viewer')
        .find((v) => within(v).queryByRole('heading', { name: title }) !== null);
      expect(viewer, `viewer for "${title}"`).toBeDefined();
      return viewer as HTMLElement;
    };

    it('renders one collapsed note per document that ships a diffFromPrevious — exactly three today — and none for the others', () => {
      renderSection();
      const withDiff = Object.values(DISCLOSURES).filter((d) => d.diffFromPrevious);
      expect(withDiff.map((d) => d.title)).toEqual([
        DISCLOSURES.app_wide.title,
        DISCLOSURES.backtest.title,
        DISCLOSURES.interview.title,
      ]);
      const notes = screen.getAllByTestId('disclosure-viewer-diff');
      expect(notes).toHaveLength(3);
      for (const note of notes) expect((note as HTMLDetailsElement).open).toBe(false);
      for (const id of ['roadmap', 'learning'] as const) {
        expect(within(viewerOf(DISCLOSURES[id].title)).queryByTestId('disclosure-viewer-diff')).toBeNull();
      }
    });

    it('the backtest note: summary names the version, the text is hidden until toggled, then reads CR-R3-2 byte-exact', () => {
      renderSection();
      const viewer = viewerOf(DISCLOSURES.backtest.title);
      const summary = within(viewer).getByText('What changed in version 1.5');
      const body = within(viewer).getByTestId('disclosure-viewer-diff-body');
      expect(body).not.toBeVisible();
      fireEvent.click(summary);
      expect(body).toBeVisible();
      expect(body.textContent?.trim()).toBe(
        'Version 1.5 changes only the acceptance checkbox: it now names all three views of the 1871–2022 replay that this document covers — the Backtest tool, the Stress Test card, and the History view — where the v1.4 checkbox named only the backtest and stress test. The body is unchanged from v1.4. Please re-read and re-accept.',
      );
      // The note sits between the version line and the body (the modal's order).
      const version = within(viewer).getByText('Version 1.5');
      const docBody = within(viewer).getByTestId('disclosure-viewer-body');
      const note = within(viewer).getByTestId('disclosure-viewer-diff');
      expect(version.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(note.compareDocumentPosition(docBody) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('every note names its own document’s version and carries that document’s diff (app_wide 1.5, interview 1.1)', () => {
      renderSection();
      const appWide = viewerOf(DISCLOSURES.app_wide.title);
      expect(within(appWide).getByText('What changed in version 1.5')).toBeInTheDocument();
      expect(within(appWide).getByTestId('disclosure-viewer-diff-body').textContent?.trim()).toBe(
        DISCLOSURES.app_wide.diffFromPrevious,
      );
      const interview = viewerOf(DISCLOSURES.interview.title);
      expect(within(interview).getByText('What changed in version 1.1')).toBeInTheDocument();
      expect(within(interview).getByTestId('disclosure-viewer-diff-body').textContent?.trim()).toBe(
        DISCLOSURES.interview.diffFromPrevious,
      );
    });

    it('the notes are read-only chrome: still no checkbox, no Continue, no "since you last accepted" heading', () => {
      renderSection();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
      expect(screen.queryByText('What changed since you last accepted:')).toBeNull();
    });
  });
});
