import { useState } from 'react';
import { DISCLOSURES } from '@/legal/disclosures';

/**
 * Persistent compact banner shown above the Roadmap. Clicking the link
 * opens the full disclosure body in a side panel so the user can re-read
 * what they accepted without leaving the page.
 */
export function DisclosureBanner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-3"
        role="note"
      >
        <span>Educational tool — not financial advice.</span>
        <button
          type="button"
          className="text-amber-900 underline hover:no-underline"
          onClick={() => setOpen(true)}
        >
          Read full →
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Roadmap disclosure"
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background text-foreground w-full sm:max-w-md h-full overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">About the Roadmap</h3>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {DISCLOSURES.roadmap.body}
            </pre>
            <div className="text-xs text-muted-foreground mt-3">
              Version {DISCLOSURES.roadmap.version}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default DisclosureBanner;
