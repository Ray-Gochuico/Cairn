import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { DISCLOSURES } from '@/legal/disclosures';
import { DisclosureChangeNote } from '@/legal/DisclosureViewer';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * The CI-5 "Read full →" target: the interview disclosure body in a side
 * panel (the DisclosureBanner Sheet pattern — Radix Sheet + ReactMarkdown
 * + version footer) so a user can re-read the consented copy without
 * leaving the card. Read-only; acceptance lives in the QuestionBar's
 * id-generic DisclosureModal gate.
 */
export function InterviewDisclosureSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="whitespace-nowrap underline hover:no-underline"
        onClick={() => setOpen(true)}
      >
        Read full →
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="text-left space-y-1">
            <SheetTitle>{DISCLOSURES.interview.title}</SheetTitle>
            <SheetDescription className="sr-only">Full interview disclosure</SheetDescription>
          </SheetHeader>
          {/* A-7(5) (v1.7.1): the shared what-changed note, collapsed, between the
              header and the body (the Settings viewer's order); nothing for an
              entry without a diff. */}
          <DisclosureChangeNote document={DISCLOSURES.interview} />
          <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground mt-3">
            <ReactMarkdown>{DISCLOSURES.interview.body}</ReactMarkdown>
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Version {DISCLOSURES.interview.version}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
