import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisclosureChangeNote, DisclosureViewer } from '@/legal/DisclosureViewer';
import { DISCLOSURES, type DisclosureDocument } from '@/legal/disclosures';

// A-7(5) (v1.7.1): the what-changed note is ONE component, shared by the
// Settings viewer and the two read-only "Read full →" sheets. The viewer's
// markup is unchanged (its region, heading and note pins stay green as they
// are); these pins prove the viewer renders THE shared note, and that the
// note keeps X1's heading map (CR-D7-3: heading levels unchanged).
const ALL = Object.values(DISCLOSURES) as DisclosureDocument[];

describe('DisclosureChangeNote (A-7(5))', () => {
  it("the Settings viewer's note IS the shared note: identical markup for every entry that ships a diff", () => {
    let compared = 0;
    for (const doc of ALL.filter((d) => d.diffFromPrevious)) {
      const alone = render(<DisclosureChangeNote document={doc} />);
      const expected = alone.getByTestId('disclosure-viewer-diff').outerHTML;
      alone.unmount();
      const inViewer = render(<DisclosureViewer document={doc} />);
      expect(inViewer.getByTestId('disclosure-viewer-diff').outerHTML, doc.title).toBe(expected);
      inViewer.unmount();
      compared += 1;
    }
    expect(compared).toBe(3); // app_wide, backtest, interview (the three shipped notes)
  });

  it('renders nothing for an entry without a diff (roadmap and learning today)', () => {
    let checked = 0;
    for (const doc of ALL.filter((d) => !d.diffFromPrevious)) {
      const { container, unmount } = render(<DisclosureChangeNote document={doc} />);
      expect(container.innerHTML, doc.title).toBe('');
      unmount();
      checked += 1;
    }
    // D7 review: the loop must not pass vacuously once every entry ships a diff.
    expect(checked).toBe(2); // roadmap, learning
  });

  it("keeps the viewer's heading map: a `##` inside a note renders as an h4 (CR-D7-3)", () => {
    const planted: DisclosureDocument = { ...DISCLOSURES.interview, diffFromPrevious: '## Changed\n\nA note.' };
    render(<DisclosureChangeNote document={planted} />);
    const body = screen.getByTestId('disclosure-viewer-diff-body');
    expect([...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName)).toEqual(['H4']);
  });
});
