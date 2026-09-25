import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PostUpdateNote } from '@/components/layout/PostUpdateNote';
import { PRE_UPDATE_NOTICE_KEY, stashPostUpdateNotice } from '@/lib/boot-notices';

const COPY = '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db';

describe('PostUpdateNote (CR-U-4, one-time)', () => {
  beforeEach(() => sessionStorage.clear());

  it('renders nothing when no update note is pending', () => {
    const { container } = render(<PostUpdateNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the copy contract under role="note" and does NOT clear the key on mount (StrictMode-safe)', () => {
    stashPostUpdateNotice(COPY);
    render(<PostUpdateNote />);
    const note = screen.getByRole('note', { name: 'Update notice' });
    expect(note).toHaveTextContent('Cairn updated your data for this version.');
    expect(note).toHaveTextContent('A copy from before the update is in Settings → Data.');
    expect(sessionStorage.getItem(PRE_UPDATE_NOTICE_KEY)).toBe(COPY);
  });

  it('Dismiss removes the note AND clears the key, so a reload shows nothing', () => {
    stashPostUpdateNotice(COPY);
    const { container } = render(<PostUpdateNote />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container).toBeEmptyDOMElement();
    expect(sessionStorage.getItem(PRE_UPDATE_NOTICE_KEY)).toBeNull();
  });

  it('has exactly one control', () => {
    stashPostUpdateNotice(COPY);
    render(<PostUpdateNote />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
