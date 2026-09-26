import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  clearRestoreFailureNotice,
  peekRestoreFailureNotice,
  restoreLeftDataUnchanged,
  withoutTrailingPeriod,
} from '@/lib/boot-notices';

/**
 * v1.7.1 U1 (code-review round 2, CR-U-20b; U1F-m2/m11): the one restore
 * failure that did NOT leave the data unchanged — db_restore set the replaced
 * file's -wal/-shm aside and could not put one back — must reach the user even
 * when the boot after it succeeds. The reason (which names where the set-aside
 * file is) rides the existing restore-failure notice key; this note shows it
 * in the app chrome on the first successful boot, beside PostUpdateNote.
 * Ordinary restore failures (data unchanged) are left for Settings → Data.
 * PEEKS on mount and clears on Dismiss, like PostUpdateNote (StrictMode-safe;
 * sessionStorage dies with the window). Warning-toned, calm.
 */
export function RestoreProblemNote() {
  const [reason, setReason] = useState<string | null>(() => {
    const r = peekRestoreFailureNotice();
    return r !== null && !restoreLeftDataUnchanged(r) ? r : null;
  });
  if (reason === null) return null;
  return (
    <div
      role="note"
      aria-label="Restore notice"
      className="flex items-center justify-between gap-4 border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning-foreground"
    >
      <p className="min-w-0 break-words">
        <span className="font-medium">The last restore did not finish.</span>{' '}
        {`${withoutTrailingPeriod(reason)}.`}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        // CR-U-23e: two Dismiss buttons can share the chrome slot — name each.
        aria-label="Dismiss the restore notice"
        onClick={() => {
          clearRestoreFailureNotice();
          setReason(null);
          // The button unmounts under focus; hand focus to the main landmark.
          document.getElementById('main')?.focus();
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
