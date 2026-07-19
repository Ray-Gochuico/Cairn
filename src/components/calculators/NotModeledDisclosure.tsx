import type { ReactNode } from 'react';

interface NotModeledDisclosureProps {
  /** The verbatim <li> bullets. Copy lives at the call site — this component
   *  standardizes only the shell. */
  children: ReactNode;
  /** Optional paragraph before the bullets (Paycheck's SS wage-base line). */
  intro?: ReactNode;
  /** Optional trailing paragraph (the "run it past a CPA" coda). */
  footer?: ReactNode;
  testId?: string;
}

/**
 * The standard "What this calculator does NOT model" block (Wave 18).
 * Component-level copy ONLY — src/legal/disclosures.ts is never involved,
 * so no version bump applies. Summary copy is standardized here; every
 * call site's bullets move over byte-for-byte.
 */
export function NotModeledDisclosure({ children, intro, footer, testId }: NotModeledDisclosureProps) {
  return (
    <details className="text-xs mt-3 border-t pt-2 text-muted-foreground" data-testid={testId}>
      <summary className="cursor-pointer font-medium hover:text-foreground">
        What this calculator does NOT model
      </summary>
      {intro != null && <p className="mt-2">{intro}</p>}
      <ul className="mt-2 list-disc pl-5 space-y-1">{children}</ul>
      {footer != null && <p className="mt-2">{footer}</p>}
    </details>
  );
}
