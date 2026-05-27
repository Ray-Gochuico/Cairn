import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisclosureBanner } from '@/components/roadmap/DisclosureBanner';
import { DISCLOSURES } from '@/legal/disclosures';

describe('DisclosureBanner', () => {
  it('renders the compact note text', () => {
    render(<DisclosureBanner />);
    expect(
      screen.getByText(/educational tool — not financial advice/i),
    ).toBeInTheDocument();
  });

  it('opens a panel with the full disclosure body when Read full is clicked', () => {
    render(<DisclosureBanner />);
    fireEvent.click(screen.getByRole('button', { name: /read full/i }));
    expect(
      screen.getByRole('heading', { name: /about the roadmap/i }),
    ).toBeInTheDocument();
    // Body should include a phrase from the disclosure copy.
    expect(
      screen.getByText(/community-maintained "\/r\/financialindependence/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Version ${DISCLOSURES.roadmap.version}`),
    ).toBeInTheDocument();
  });

  it('closes the panel when the close button is clicked', () => {
    render(<DisclosureBanner />);
    fireEvent.click(screen.getByRole('button', { name: /read full/i }));
    expect(
      screen.getByRole('heading', { name: /about the roadmap/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(
      screen.queryByRole('heading', { name: /about the roadmap/i }),
    ).toBeNull();
  });

  // W6-Design: the side panel used to wrap the body in <pre>, which
  // rendered `**About the Roadmap feature**` as literal asterisks. After
  // switching to ReactMarkdown the same source string should produce a
  // real <strong> element and the asterisks must disappear from the
  // rendered text.
  it('renders **bold** body markdown as <strong>, not literal asterisks', () => {
    render(<DisclosureBanner />);
    fireEvent.click(screen.getByRole('button', { name: /read full/i }));

    // The exact string is "**About the Roadmap feature**" at the top of
    // the body. ReactMarkdown should produce a <strong> wrapping
    // "About the Roadmap feature" — no asterisks in the DOM text.
    const strongs = screen.getAllByText('About the Roadmap feature');
    // One copy is the h3 heading we render ourselves; another is the
    // markdown-rendered <strong>. We only care that at least one is a
    // <strong>.
    const renderedStrong = strongs.find(
      (el) => el.tagName.toLowerCase() === 'strong',
    );
    expect(renderedStrong).toBeDefined();

    // Literal "**About the Roadmap feature**" must NOT appear in the
    // rendered text (the regression we're guarding against).
    expect(
      screen.queryByText(/\*\*About the Roadmap feature\*\*/),
    ).toBeNull();
  });
});
