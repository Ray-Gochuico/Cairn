import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
 * Focus management (R14 wiring-sweep, prior to 2026-05-27 this was a
 * hand-rolled `<div role="dialog">` with no focus trap — focus could
 * leak to background controls and the visible Tab/Shift+Tab order was
 * indeterminate. Now built on @radix-ui/react-dialog which is the
 * shadcn/ui Dialog primitive's underlying library and gives us:
 *   - focus trap inside the modal while open
 *   - returns focus to the element that opened the modal on close
 *   - Escape closes (handled via DialogPrimitive)
 *   - aria-modal, aria-labelledby, role="dialog" emitted automatically
 *   - blocks page scroll while open
 *
 * We do NOT use the shadcn `Dialog` wrapper directly because that
 * component renders a built-in close ("X") button which is wrong for
 * an attestation modal — the user must click "Continue" or "Cancel".
 * Composing the primitive lets us keep the existing checkbox-gated
 * Continue button as the only acceptance path.
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
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[100] bg-black/40',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-[101] -translate-x-1/2 -translate-y-1/2',
            'bg-white rounded-lg max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh]',
            'flex flex-col shadow-xl outline-none',
          )}
          aria-describedby={undefined}
          // Suppress the Radix-default close-on-pointer-down-outside;
          // the Cancel/Continue buttons are the only legitimate exits.
          // When onCancel is missing, even Escape stays a no-op (handled
          // in handleOpenChange above).
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
        <div className="px-6 py-4 border-b">
          <DialogPrimitive.Title
            id="disclosure-modal-title"
            className="text-lg font-semibold"
          >
            {title}
          </DialogPrimitive.Title>
          <div className="text-xs text-slate-500">Version {document.version}</div>
        </div>

        {document.diffFromPrevious && (
          <div className="mx-6 mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
            <div className="font-semibold text-amber-900 mb-1">
              What changed since you last accepted:
            </div>
            <div className="text-amber-900 space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
              <ReactMarkdown>{document.diffFromPrevious}</ReactMarkdown>
            </div>
          </div>
        )}

        <div
          className="px-6 py-4 overflow-y-auto flex-1 text-sm leading-relaxed text-slate-700 space-y-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-primary [&_a]:underline"
          data-testid="disclosure-modal-body"
        >
          <ReactMarkdown>{document.body}</ReactMarkdown>
        </div>

        <div className="px-6 py-3 border-t bg-slate-50">
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
          <div className="px-6 py-2 text-sm text-red-700 bg-red-50 border-t border-red-200">
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default DisclosureModal;
