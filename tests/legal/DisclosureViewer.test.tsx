import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { DisclosureViewer } from '@/legal/DisclosureViewer';
import { DISCLOSURES, type DisclosureDocument } from '@/legal/disclosures';

// A-11(2) (v1.7.1): the viewer's own title is an <h3> (under Settings'
// "Disclosures" <h2>), so markdown inside it renders BELOW h3. The interview
// body opens `## Mechanical frameworks, not advice`, which rendered as an
// <h2> inside the h3-titled region (R3 smoke). The fix is the RENDERER's:
// every body is byte-identical (its SHA/length pins in
// tests/legal/disclosures.test.ts stay green untouched) and only heading
// LEVELS change (CR-X1-2).
const LEVEL_MAP: Record<string, string> = { H1: 'H4', H2: 'H4', H3: 'H5', H4: 'H6', H5: 'H6', H6: 'H6' };
const headingsIn = (el: Element) =>
  [...el.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => `${h.tagName}:${h.textContent}`);

describe('DisclosureViewer — markdown headings sit below the viewer title (A-11(2))', () => {
  it('About the Frameworks: the body heading is an h4 under the h3 title — no h1/h2 inside, one h3', () => {
    render(<DisclosureViewer document={DISCLOSURES.interview} />);
    const viewer = screen.getByTestId('disclosure-viewer');
    expect(within(viewer).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['About the Frameworks']);
    expect(within(viewer).getByRole('heading', { level: 4, name: 'Mechanical frameworks, not advice' })).toBeInTheDocument();
    expect(within(viewer).queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(within(viewer).queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });

  it('every markdown level maps below h3 (h1/h2 → h4, h3 → h5, h4–h6 → h6) — in the body AND the what-changed note', () => {
    const planted: DisclosureDocument = {
      ...DISCLOSURES.interview,
      title: 'Planted',
      body: '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six',
      diffFromPrevious: '## Changed\n\nA note.',
    };
    render(<DisclosureViewer document={planted} />);
    expect(headingsIn(screen.getByTestId('disclosure-viewer-body'))).toEqual(
      ['H4:One', 'H4:Two', 'H5:Three', 'H6:Four', 'H6:Five', 'H6:Six'],
    );
    expect(headingsIn(screen.getByTestId('disclosure-viewer-diff-body'))).toEqual(['H4:Changed']);
  });

  it('only heading LEVELS change: every registry body AND what-changed note renders byte-identical text and the same element sequence (modulo the map) as the plain renderer', () => {
    const plainOf = (md: string) => {
      const plain = render(<div data-testid="plain"><ReactMarkdown>{md}</ReactMarkdown></div>);
      const el = plain.getByTestId('plain');
      const out = { text: el.textContent, tags: [...el.querySelectorAll('*')].map((e) => LEVEL_MAP[e.tagName] ?? e.tagName) };
      plain.unmount();
      return out;
    };
    const renderedOf = (el: HTMLElement) => ({ text: el.textContent, tags: [...el.querySelectorAll('*')].map((e) => e.tagName) });
    let notes = 0;
    for (const doc of Object.values(DISCLOSURES) as DisclosureDocument[]) {
      const expectedBody = plainOf(doc.body);
      const expectedNote = doc.diffFromPrevious ? plainOf(doc.diffFromPrevious) : null;
      const view = render(<DisclosureViewer document={doc} />);
      expect(renderedOf(view.getByTestId('disclosure-viewer-body')), doc.title).toEqual(expectedBody);
      if (expectedNote) {
        notes += 1;
        // The note sits in a collapsed <details>; its markdown is in the DOM regardless.
        expect(renderedOf(view.getByTestId('disclosure-viewer-diff-body')), `${doc.title} (note)`).toEqual(expectedNote);
      }
      view.unmount();
    }
    expect(notes).toBe(3); // guard: the three shipped notes (disclosures.ts :144, :167, :176) were all compared
  });

  it("the demoted `##` keeps its look: the body carries the [&_h4] trio beside the modal's shared [&_h2] trio", () => {
    render(<DisclosureViewer document={DISCLOSURES.interview} />);
    const cls = screen.getByTestId('disclosure-viewer-body').className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining([
      '[&_h4]:text-sm', '[&_h4]:font-semibold', '[&_h4]:mt-3',
      '[&_h2]:text-sm', '[&_h2]:font-semibold', '[&_h2]:mt-3',
    ]));
  });
});
