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
});
