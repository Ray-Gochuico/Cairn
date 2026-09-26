import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearPostUpdateNotice, peekPostUpdateNote } from '@/lib/boot-notices';

/**
 * v1.7.1 U1 (CR-U-4): the one-time calm note after a boot that migrated the
 * database with a pre-update copy taken first. Same chrome slot and tone as
 * SampleDataBanner (PageShell renders one or the other, never both). PEEKS
 * the session key on mount and clears it on Dismiss — a read-once on mount
 * would blank the note under React 19 StrictMode's double-invoked
 * initializers; sessionStorage dies with the window, so the note can never
 * survive into a later launch.
 */
export function PostUpdateNote() {
  const [note, setNote] = useState(() => peekPostUpdateNote());
  if (note === null) return null;
  return (
    <div
      role="note"
      aria-label="Update notice"
      className="flex items-center justify-between gap-4 border-b border-info/40 bg-info-soft px-4 py-2 text-sm text-info-foreground"
    >
      <p className="min-w-0">
        <span className="font-medium">Cairn updated your data for this version.</span>{' '}
        {note.fromBeforeUpdate
          ? 'A copy from before the update is in Settings → Data.'
          : // U1F-m10: a partway retry's copy is not from before the update.
            'The copy in Settings → Data was saved after an earlier attempt had changed part of your data, so it is not from before the update.'}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        // CR-U-23e: two Dismiss buttons can share the chrome slot — name each.
        aria-label="Dismiss the update notice"
        onClick={() => {
          clearPostUpdateNotice();
          setNote(null);
          // U1-m22: the button unmounts under focus; hand focus to the page's
          // main landmark (PageShell's <main id="main" tabIndex={-1}>).
          document.getElementById('main')?.focus();
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
