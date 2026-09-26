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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the update notice' }));
    expect(container).toBeEmptyDOMElement();
    expect(sessionStorage.getItem(PRE_UPDATE_NOTICE_KEY)).toBeNull();
  });

  it('U1-m22: Dismiss hands focus to the main landmark instead of dropping it on <body>', () => {
    stashPostUpdateNotice(COPY);
    render(
      <>
        <main id="main" tabIndex={-1} />
        <PostUpdateNote />
      </>,
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss the update notice' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('U1F-m10: after a partway retry the note never calls its copy "from before the update"', () => {
    stashPostUpdateNotice('/x/backups/cairn-pre-update-54-to-55-20260925-101500.db', false);
    render(<PostUpdateNote />);
    const note = screen.getByRole('note', { name: 'Update notice' });
    expect(note).toHaveTextContent('Cairn updated your data for this version.');
    expect(note).toHaveTextContent(
      'The copy in Settings → Data was saved after an earlier attempt had changed part of your data, so it is not from before the update.',
    );
    expect(note).not.toHaveTextContent('A copy from before the update');
  });

  it('has exactly one control', () => {
    stashPostUpdateNotice(COPY);
    render(<PostUpdateNote />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
