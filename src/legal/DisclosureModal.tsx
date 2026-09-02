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

interface SecondaryAction {
  label: string;
  helper: string;
  busyLabel: string;
  onSelect: () => void | Promise<void>;
}

interface Props {
  document: DisclosureDocument & { id: DisclosureId };
  onAccept: (version: string) => void | Promise<void>;
  onCancel?: () => void;
  continueLabel?: string;
  /**
   * Optional branded header rendered ABOVE the disclosure title (T23). Only the
   * first-run Setup Step 0 passes it (a welcome frame); re-prompt gates render
   * without it, so their look is unchanged. The versioned body is NOT touched.
   */
  heroHeader?: React.ReactNode;
  /**
   * When false, Escape does NOT dismiss even though an onCancel is provided —
   * the explicit Cancel button stays the only non-accept exit. Default true
   * keeps every existing gate's Escape→onCancel semantics byte-identical
   * (e.g. the Roadmap gate's Escape→navigate('/')); only the interview
   * QuestionBar opts out (its smoke checklist pins "Escape/outside-click
   * does NOT dismiss; Cancel returns without computing").
   */
  dismissOnEscape?: boolean;
  /**
   * W4: optional quiet secondary action (Step 0's "Explore with sample data
   * first"). Gated on the SAME attestation checkbox — exploring is inside the
   * acceptance, never around it. Only Step0Disclaimer passes it; the
   * AppDisclaimerGate re-prompt never does, so the legal re-accept surface is
   * untouched.
   */
  secondaryAction?: SecondaryAction;
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
  heroHeader,
  dismissOnEscape = true,
  secondaryAction,
}: Props) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [secondaryBusy, setSecondaryBusy] = useState(false);

  // Total over DisclosureId — every disclosure carries its own title, so a new
  // id (e.g. backtest) needs zero edits here (W3). Fallback keeps tsc + render
  // safe even if a title were ever omitted.
  const title = document.title ?? 'Disclaimer';

  const [error, setError] = useState<string | null>(null);
  /**
   * W4: the secondary action runs behind the SAME attestation gate as
   * Continue, and cross-locks with it while in flight. On success the caller
   * navigates away (a full page load), so there is deliberately no state
   * reset — the busy label stays until the navigation lands.
   */
  const handleSecondary = async () => {
    if (!checked || submitting || secondaryBusy || !secondaryAction) return;
    setSecondaryBusy(true);
    setError(null);
    try {
      await secondaryAction.onSelect();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Failed to open sample data. Please try again.',
      );
      setSecondaryBusy(false);
    }
  };

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
          if (!onCancel || !dismissOnEscape) e.preventDefault();
        }}
      >
        {heroHeader}
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
          <div className="px-6 py-2 text-sm text-destructive-soft-foreground bg-destructive/10 border-t border-destructive/30">
            {error}
          </div>
        )}

        <div className="px-6 py-3 border-t flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={submitting || secondaryBusy}>
              Cancel
            </Button>
          )}
          <Button disabled={!checked || submitting || secondaryBusy} onClick={handleAccept}>
            {continueLabel}
          </Button>
        </div>

        {secondaryAction && (
          <div className="px-6 pb-4 flex flex-col items-end gap-1 text-right">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm text-muted-foreground underline-offset-4"
              disabled={!checked || submitting || secondaryBusy}
              onClick={() => void handleSecondary()}
            >
              {secondaryBusy ? secondaryAction.busyLabel : secondaryAction.label}
            </Button>
            <p className="text-xs text-muted-foreground">{secondaryAction.helper}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DisclosureModal;
