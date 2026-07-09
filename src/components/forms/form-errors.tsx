import { useCallback, useState } from 'react';

/**
 * Wave-10 form-honesty primitives (M44 + design panel). Three problems, one
 * module: (1) every form but HouseholdForm let a rejected save escape as an
 * unhandled rejection — useFormSubmit catches it into submitError; (2) the
 * copy-pasted banner printed raw RHF keys in font-mono plus raw Zod output —
 * FormErrorSummary names humanized fields and defers details to (3)
 * FieldError, the inline per-field message reached via aria-describedby.
 * The summary keeps the destructive-soft pane idiom (see its className) with
 * role="alert" on the same tag, so the form-error-alert policy still guards it.
 */

export function humanizeFieldName(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Map Zod v4 default phrasings to plain language; custom messages pass through. */
export function humanizeZodMessage(raw: string | undefined): string {
  if (!raw) return 'Invalid value';
  const str = raw.match(/^Too small: expected string to have >=?(\d+) characters?/i);
  if (str) return Number(str[1]) <= 1 ? 'Required' : `Must be at least ${str[1]} characters`;
  const min = raw.match(/^Too small: expected number to be >=?\s*(-?[\d.]+)/i);
  if (min) return `Must be at least ${min[1]}`;
  const max = raw.match(/^Too big: expected number to be <=?\s*(-?[\d.]+)/i);
  if (max) return `Must be at most ${max[1]}`;
  if (/^Invalid input: expected number/i.test(raw)) return 'Enter a number';
  if (/^Invalid input: expected string/i.test(raw)) return 'Required';
  if (/^Invalid option/i.test(raw) || /^Invalid enum/i.test(raw)) return 'Choose an option';
  return raw;
}

/** Inline per-field message. Plain text (not a live region — the summary owns
 * announcement); the OWNING input points here via aria-describedby and sets
 * aria-invalid, which lights the red border added to ui/input.tsx. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-destructive-soft-foreground">
      {humanizeZodMessage(message)}
    </p>
  );
}

export interface FormErrorSummaryProps {
  /** react-hook-form's formState.errors (or any {field: {message}} record). */
  fieldErrors: Record<string, { message?: string } | undefined>;
  /** useFormSubmit's submitError. */
  submitError?: string | null;
  /** Optional pretty labels; falls back to humanizeFieldName. */
  labels?: Record<string, string>;
}

export function FormErrorSummary({ fieldErrors, submitError, labels }: FormErrorSummaryProps) {
  const fields = Object.keys(fieldErrors).filter((k) => fieldErrors[k]);
  if (fields.length === 0 && !submitError) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
    >
      {submitError ? (
        <div className="font-medium">
          Couldn’t save — {submitError}. Your changes are still on this form; try again.
        </div>
      ) : (
        <div className="font-medium">
          Fix {fields.length === 1 ? 'this field' : `these ${fields.length} fields`} before saving:{' '}
          {fields.map((f) => labels?.[f] ?? humanizeFieldName(f)).join(', ')}
        </div>
      )}
    </div>
  );
}

/** Wrap the caller-owned onSubmit so a rejected save lands in submitError
 * instead of an unhandled rejection (M44). Forms pass onValid to RHF's
 * handleSubmit; store mutations keep rethrowing (state-layer contract). */
export function useFormSubmit<T>(onSubmit: (values: T) => Promise<void> | void) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const onValid = useCallback(
    async (values: T) => {
      setSubmitError(null);
      setSubmitting(true);
      try {
        await onSubmit(values);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Could not save.');
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit],
  );
  return { onValid, submitting, submitError };
}
