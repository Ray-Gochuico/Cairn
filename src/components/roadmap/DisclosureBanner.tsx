import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { DISCLOSURES } from '@/legal/disclosures';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
        className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-foreground flex items-center justify-between gap-3"
        role="note"
      >
        <span>Educational tool — not financial advice.</span>
        <button
          type="button"
          className="text-warning-foreground underline hover:no-underline"
          onClick={() => setOpen(true)}
        >
          Read full →
        </button>
      </div>
      {/* W10 M27: was a hand-rolled fake-modal div (no focus trap, no Escape,
          no scroll lock). Radix Sheet supplies all three + a Close button. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="text-left space-y-1">
            <SheetTitle>About the Roadmap</SheetTitle>
            <SheetDescription className="sr-only">Full roadmap disclosure</SheetDescription>
          </SheetHeader>
          {/*
           * Render the disclosure body as Markdown so **bold** and other
           * inline formatting render correctly, matching DisclosureModal.
           */}
          <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground mt-3">
            <ReactMarkdown>{DISCLOSURES.roadmap.body}</ReactMarkdown>
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Version {DISCLOSURES.roadmap.version}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default DisclosureBanner;
