import { useState } from 'react';
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
 * The body is rendered as preformatted text rather than parsed markdown
 * to avoid pulling in react-markdown for a single component — the
 * source strings in `disclosures.ts` use Markdown-ish syntax (`**bold**`,
 * `- bullet`) that reads fine raw, and switching to a renderer later is
 * a one-line change.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclosure-modal-title"
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b">
          <h2 id="disclosure-modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-xs text-slate-500">Version {document.version}</div>
        </div>

        {document.diffFromPrevious && (
          <div className="mx-6 mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
            <div className="font-semibold text-amber-900 mb-1">
              What changed since you last accepted:
            </div>
            <pre className="whitespace-pre-wrap font-sans text-amber-900">
              {document.diffFromPrevious}
            </pre>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto flex-1">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
            {document.body}
          </pre>
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
      </div>
    </div>
  );
}

export default DisclosureModal;
