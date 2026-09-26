import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RestoreProblemNote } from '@/components/layout/RestoreProblemNote';
import { RESTORE_FAILURE_NOTICE_KEY, stashRestoreFailureNotice } from '@/lib/boot-notices';

// CR-U-20(b) (U1F-m2/m11): db_restore's put-back failure is the one restore
// failure where the data was NOT left unchanged, and the boot after it can
// succeed — so it must reach the user in the app chrome, not only in
// Settings → Data or on a boot screen that may never show.
const PUT_BACK =
  'db_restore: failed to finalize the restore: denied. Part of your current data could not be put back: /x/finance.db-wal is at /x/finance.db-wal.restore-old (denied)';

describe('RestoreProblemNote (CR-U-20b, one-time)', () => {
  beforeEach(() => sessionStorage.clear());

  it('renders nothing when no restore failed', () => {
    const { container } = render(<RestoreProblemNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an ordinary restore failure (data unchanged — Settings → Data reports it)', () => {
    stashRestoreFailureNotice('disk full during restore');
    const { container } = render(<RestoreProblemNote />);
    expect(container).toBeEmptyDOMElement();
    expect(sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBe('disk full during restore'); // left for Settings
  });

  it('CR-U-23c: a stuck -shm only (the rebuildable index) never shows the note', () => {
    stashRestoreFailureNotice('db_restore: failed to finalize the restore (your data is unchanged): denied. The index file /x/finance.db-shm is at /x/finance.db-shm.restore-old (denied); SQLite rebuilds it from your data');
    const { container } = render(<RestoreProblemNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a put-back failure: the note names it under role="note", and does NOT clear the key on mount', () => {
    stashRestoreFailureNotice(PUT_BACK);
    render(<RestoreProblemNote />);
    const note = screen.getByRole('note', { name: 'Restore notice' });
    expect(note).toHaveTextContent(`The last restore did not finish. ${PUT_BACK}.`);
    expect(sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBe(PUT_BACK);
  });

  it('Dismiss removes the note, clears the key and hands focus to the main landmark', () => {
    stashRestoreFailureNotice(PUT_BACK);
    const { container } = render(
      <>
        <main id="main" tabIndex={-1} />
        <RestoreProblemNote />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('note', { name: 'Restore notice' })).toBeNull();
    expect(sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('main'));
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
