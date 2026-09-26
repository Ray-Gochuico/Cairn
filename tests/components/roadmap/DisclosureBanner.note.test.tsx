/**
 * A-7(5) (v1.7.1): the Roadmap "Read full →" sheet renders the shared
 * what-changed note. The roadmap entry ships no diff at 1.0, so the wiring is
 * pinned with a PLANTED diff through a file-scoped registry mock (a separate
 * file for that reason; the registry itself is never edited).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DISCLOSURE_VERSIONS } from '../../helpers/disclosure-versions';

vi.mock('@/legal/disclosures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/legal/disclosures')>();
  return {
    ...actual,
    DISCLOSURES: {
      ...actual.DISCLOSURES,
      roadmap: { ...actual.DISCLOSURES.roadmap, diffFromPrevious: 'Planted roadmap note.' },
    },
  };
});

import { DisclosureBanner } from '@/components/roadmap/DisclosureBanner';

describe('DisclosureBanner — the what-changed note (A-7(5))', () => {
  it('a roadmap diff shows as the collapsed shared note inside the About the Roadmap sheet, above the body', () => {
    render(<DisclosureBanner />);
    fireEvent.click(screen.getByRole('button', { name: /read full/i }));
    const sheet = screen.getByRole('dialog', { name: 'About the Roadmap' });
    const note = within(sheet).getByTestId('disclosure-viewer-diff') as HTMLDetailsElement;
    expect(note.open).toBe(false);
    expect(within(note).getByText(`What changed in version ${DISCLOSURE_VERSIONS.roadmap}`)).toBeInTheDocument();
    expect(within(note).getByTestId('disclosure-viewer-diff-body').textContent?.trim()).toBe('Planted roadmap note.');
    const bodyLead = within(sheet).getAllByText('About the Roadmap feature').find((el) => el.tagName === 'STRONG')!;
    expect(Boolean(note.compareDocumentPosition(bodyLead) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
