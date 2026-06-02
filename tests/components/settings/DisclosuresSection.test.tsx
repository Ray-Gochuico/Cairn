import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('renders all four consented documents, each in its own viewer with its title as a heading', () => {
    renderSection();
    const viewers = screen.getAllByTestId('disclosure-viewer');
    expect(viewers).toHaveLength(4);
    // Each DISCLOSURES doc surfaces its own title as the viewer's <h3>. We scope
    // to the heading because several bodies OPEN with the same bold line (e.g.
    // "**About the Learning feature**"), so a bare getByText would be ambiguous.
    for (const doc of Object.values(DISCLOSURES)) {
      const headingMatches = viewers
        .map((v) => within(v).queryByRole('heading', { name: doc.title }))
        .filter((el): el is HTMLElement => el !== null);
      expect(headingMatches, `expected a viewer heading for "${doc.title}"`).toHaveLength(1);
    }
    // Sanity: exactly the four we expect.
    expect(Object.keys(DISCLOSURES)).toHaveLength(4);
  });

  it('shows each document version', () => {
    renderSection();
    // app_wide=1.5, roadmap=1.0, learning=1.0, backtest=1.2 — versions are
    // surfaced so a user can see which revision they are reading.
    expect(screen.getByText(/Version 1\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Version 1\.2/)).toBeInTheDocument();
    expect(screen.getAllByText(/Version 1\.0/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders each document body as Markdown (bold → <strong>, no literal asterisks)', () => {
    renderSection();
    // app_wide body opens with a **bold** sentence; after react-markdown the
    // asterisks are gone and a <strong> exists in that doc's rendered body.
    const bodies = screen.getAllByTestId('disclosure-viewer-body');
    expect(bodies).toHaveLength(4);
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
    expect(within(appWide as HTMLElement).getByText(/Version 1\.5/)).toBeInTheDocument();
  });
});
