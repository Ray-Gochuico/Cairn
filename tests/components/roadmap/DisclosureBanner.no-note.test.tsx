/**
 * A-7(5) (v1.7.1, D7 review): the REAL registry, unmocked. Roadmap 1.0 ships
 * no diffFromPrevious, so the About the Roadmap "Read full →" sheet shows no
 * what-changed note today (CX-D7-2). The planted-diff wiring pin lives in
 * DisclosureBanner.note.test.tsx (its registry mock is file-scoped, hence the
 * separate file); this one guards the empty arm against a fallback diff.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DisclosureBanner } from '@/components/roadmap/DisclosureBanner';
import { DISCLOSURES } from '@/legal/disclosures';
import { DISCLOSURE_VERSIONS } from '../../helpers/disclosure-versions';

describe('DisclosureBanner — no what-changed note while roadmap ships none (A-7(5))', () => {
  it('the About the Roadmap sheet shows the body and version, and no note', () => {
    // The premise, stated: a roadmap bump ships its own diff (the registry
    // rule), and this pin is re-targeted with it.
    expect(DISCLOSURES.roadmap.diffFromPrevious).toBeUndefined();
    render(<DisclosureBanner />);
    fireEvent.click(screen.getByRole('button', { name: /read full/i }));
    const sheet = screen.getByRole('dialog', { name: 'About the Roadmap' });
    expect(within(sheet).getByText(`Version ${DISCLOSURE_VERSIONS.roadmap}`)).toBeInTheDocument();
    expect(within(sheet).queryByTestId('disclosure-viewer-diff')).toBeNull();
    expect(within(sheet).queryByText(/^What changed in version/)).toBeNull();
  });
});
