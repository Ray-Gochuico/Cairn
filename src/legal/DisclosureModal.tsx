import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { DisclosureDocument } from './disclosures';
import type { DisclosureId } from './disclosures';

interface Props {
  document: DisclosureDocument & { id: DisclosureId };
  onAccept: (version: string) => void | Promise<void>;
  onCancel?: () => void;
  continueLabel?: string;
}

/**
 * Full-screen disclosure modal used by both the Setup Wizard's Step 0
 * and the top-level AppDisclaimerGate (for version-bump re-prompts).
 *
 * The body is rendered as Markdown via react-markdown (commit 3fa829e).
 *
 * Focus management (R14 wiring-sweep): built on the shadcn `<Dialog>` /
 * `<DialogContent>` wrappers which compose `@radix-ui/react-dialog`
 * (shadcn ships with `DialogTitle` registered in the same context the
 * `DialogContent` consumes, so Radix's accessibility check fires cleanly
 * without the 96-warning spew the hand-rolled primitive composition had).
 * Per the Wave-3 UX review (W3-1), the prior `DialogPrimitive.Root` + raw
 * `Content` composition was emitting `DialogContent requires a DialogTitle`
 * warnings even though a Title was present — moving onto the shadcn
 * wrapper resolves this because that wrapper's `DialogContent` uses the
 * exact `forwardRef` pattern Radix's runtime check is designed to detect.
 *
 * Gives us:
 *   - focus trap inside the modal while open
 *   - returns focus to the element that opened the modal on close
 *   - Escape closes (handled via Radix)
 *   - aria-modal, aria-labelledby, role="dialog" emitted automatically
 *   - blocks page scroll while open
 *
 * Shadcn's `DialogContent` ships a built-in close ("X") button which is
 * wrong for an attestation modal — the user must click "Continue" or
 * "Cancel". We hide that close button via the `[&>button:last-child]:hidden`
 * className override (the close is rendered as the LAST child of Content)
 * AND we wire `onPointerDownOutside` / `onInteractOutside` / `onEscapeKeyDown`
 * to preventDefault so overlay-click / Escape don't close either. The
 * Cancel button (when provided) is the only legitimate exit besides
 * Continue.
 *
 * Continue is disabled until the required acknowledgment checkbox is
 * checked. Cancel is only rendered when an `onCancel` is provided —
 * the AppDisclaimerGate intentionally omits it (the user must accept
 * the current version to use the app).
 */
export function DisclosureModal({
  document,
  onAccept,
  onCancel,
  continueLabel = 'Continue',
}: Props) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = document.id === 'app_wide' ? 'Disclaimer' : 'About the Roadmap';

  const [error, setError] = useState<string | null>(null);
  const handleAccept = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept(document.version);
    } catch (e) {
      // Surface the error inline so the user can retry instead of bubbling
      // it up to an unhandled rejection. The caller's onAccept is expected
      // to write to the DB; transient failures are rare but possible.
      setError(e instanceof Error ? e.message : 'Failed to record acceptance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Always open while mounted; close is driven by the parent unmounting
  // the modal after onAccept / onCancel. Radix uses `onOpenChange(false)`
  // to surface Escape + overlay clicks; we route both into the same
  // `handleCancelIntent` so the parent can decide whether to honour them.
  const handleOpenChange = (open: boolean) => {
    if (open) return;
    // Escape / overlay-click intent. Defer to the explicit Cancel button
    // path: only fire onCancel when the parent provided one (i.e. the
    // SetupWizard / re-prompt UI that has a Cancel-equivalent flow). The
    // AppDisclaimerGate omits onCancel — Escape there is a no-op (the
    // user has to accept the disclaimer to use the app), which matches
    // the pre-fix hand-rolled modal's behavior.
    if (onCancel) onCancel();
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        // Wave-5 frontend A+ #4: explicit aria-modal. Radix infers this via
        // role="dialog" + portal-and-focus-trap, but older AT (VoiceOver
        // <=12, some Windows narrator builds, JAWS in browse mode) reads
        // the inferred value inconsistently. Setting it explicitly closes
        // the gap with no behavior change for modern AT.
        aria-modal="true"
        // Hide the shadcn-default close ("X") button: it's the last child
        // of <DialogContent>. Composition is keyboard-friendly + the
        // explicit Cancel/Continue buttons remain the only acceptance
        // affordances.
        className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] p-0 flex flex-col gap-0 overflow-hidden [&>button:last-child]:hidden"
        // Suppress the Radix-default close-on-pointer-down-outside;
        // the Cancel/Continue buttons are the only legitimate exits.
        // When onCancel is missing, even Escape stays a no-op (handled
        // in handleOpenChange above).
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (!onCancel) e.preventDefault();
        }}
      >
        <div className="px-6 py-4 border-b">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Version {document.version}
          </DialogDescription>
        </div>

        {document.diffFromPrevious && (
          <div className="mx-6 mt-3 p-3 bg-warning-soft border border-warning/40 rounded text-sm">
            <div className="font-semibold text-warning-foreground mb-1">
              What changed since you last accepted:
            </div>
            <div className="text-warning-foreground space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
              <ReactMarkdown>{document.diffFromPrevious}</ReactMarkdown>
            </div>
          </div>
        )}

        <div
          className="px-6 py-4 overflow-y-auto flex-1 text-sm leading-relaxed text-foreground space-y-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-primary [&_a]:underline"
          data-testid="disclosure-modal-body"
        >
          <ReactMarkdown>{document.body}</ReactMarkdown>
        </div>

        <div className="px-6 py-3 border-t bg-muted">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer"
              aria-label={document.acceptanceCheckboxLabel}
            />
            <span>{document.acceptanceCheckboxLabel}</span>
          </label>
        </div>

        {error && (
          <div className="px-6 py-2 text-sm text-destructive bg-destructive/10 border-t border-destructive/30">
            {error}
          </div>
        )}

        <div className="px-6 py-3 border-t flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button disabled={!checked || submitting} onClick={handleAccept}>
            {continueLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DisclosureModal;
