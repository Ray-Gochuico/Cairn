import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InterviewDisclosureSheet } from '@/components/interview/InterviewDisclosureSheet';
import { DISCLOSURES } from '@/legal/disclosures';
import { DISCLOSURE_VERSIONS } from '../../helpers/disclosure-versions';

// A-7(5) (v1.7.1): the interview "Read full →" sheet (FrameworkCard's CI-5
// target) shows the same collapsed what-changed note as Settings →
// Disclosures, between its header and the body. Read-only: the attestation
// lives in the QuestionBar's DisclosureModal gate. First direct test of this
// component (it is not the frozen kernel: src/components/interview).
function openSheet() {
  render(<InterviewDisclosureSheet />);
  fireEvent.click(screen.getByRole('button', { name: 'Read full →' }));
  return screen.getByRole('dialog', { name: DISCLOSURES.interview.title });
}

describe('InterviewDisclosureSheet — the what-changed note (A-7(5))', () => {
  it('the sheet carries the collapsed note for the current version, reading the registry diff', () => {
    const sheet = openSheet();
    const note = within(sheet).getByTestId('disclosure-viewer-diff') as HTMLDetailsElement;
    expect(note.open).toBe(false);
    expect(within(note).getByText(`What changed in version ${DISCLOSURE_VERSIONS.interview}`)).toBeInTheDocument();
    // D-D7-4 (plan review): on open, focus sits on the note's summary, the first
    // tabbable element in the sheet (before A-7(5), focus opened on the Close
    // button, which now follows the note).
    expect(document.activeElement).toBe(within(note).getByText(`What changed in version ${DISCLOSURE_VERSIONS.interview}`));
    expect(within(note).getByTestId('disclosure-viewer-diff-body').textContent?.trim()).toBe(
      DISCLOSURES.interview.diffFromPrevious,
    );
    expect(within(note).getByTestId('disclosure-viewer-diff-body')).not.toBeVisible();
    fireEvent.click(within(note).getByText(`What changed in version ${DISCLOSURE_VERSIONS.interview}`));
    expect(within(note).getByTestId('disclosure-viewer-diff-body')).toBeVisible();
  });

  it('order: title, then the note, then the body, then the version line (the viewer order, footer kept)', () => {
    const sheet = openSheet();
    const title = within(sheet).getByRole('heading', { name: DISCLOSURES.interview.title });
    const note = within(sheet).getByTestId('disclosure-viewer-diff');
    const bodyHeading = within(sheet).getByRole('heading', { name: 'Mechanical frameworks, not advice' });
    const version = within(sheet).getByText(`Version ${DISCLOSURE_VERSIONS.interview}`);
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, note)).toBe(true);
    expect(follows(note, bodyHeading)).toBe(true);
    expect(follows(bodyHeading, version)).toBe(true);
    expect(note.contains(bodyHeading)).toBe(false);
  });

  it('stays read-only: no checkbox, no Continue', () => {
    const sheet = openSheet();
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /continue/i })).toBeNull();
  });
});
