import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { getGlossaryEntry } from '@/lib/glossary';

interface TermTooltipProps {
  /** Lookup key in `src/lib/glossary.ts`. Case-insensitive. */
  term: string;
  /**
   * What renders as the on-screen text. Defaults to the literal `term`.
   * Pass a child to keep the visible label (e.g., "Coast FI") distinct
   * from the lookup key (e.g., `COAST FI`).
   */
  children?: ReactNode;
  /** Optional extra className applied to the trigger span. */
  className?: string;
}

/**
 * Inline glossary affordance — wraps a financial term so a non-financial
 * friend can hover (or tap on mobile / keyboard-focus) and see a definition.
 *
 * Renders the wrapped text with a subtle dotted underline + an ⓘ icon.
 * Hover, focus, and click all open the popover; click toggles, so tapping
 * outside or pressing Escape closes it.
 *
 * Definitions live in `src/lib/glossary.ts`. If a term isn't in the
 * glossary, the wrapper falls back to a plain inline span (no UI nag)
 * and logs a dev-mode warning so the missing entry surfaces in CI.
 */
export function TermTooltip({ term, children, className }: TermTooltipProps) {
  const entry = getGlossaryEntry(term);
  const triggerId = useId();
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (entry) return;
    if (import.meta.env.DEV) {
      // Surface unknown terms so the dev sees the gap in src/lib/glossary.ts.
      console.warn(`[TermTooltip] no glossary entry for "${term}"`);
    }
  }, [entry, term]);

  // Unknown term — just render the children inline, no tooltip affordance.
  if (!entry) {
    return <span className={className}>{children ?? term}</span>;
  }

  return (
    <span
      ref={wrapperRef}
      className={cn('relative inline-block', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        id={triggerId}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Only close on focus leaving the whole wrapper.
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            close();
          }
        }}
        className="inline-flex items-baseline gap-0.5 underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm bg-transparent cursor-help"
      >
        <span>{children ?? entry.term}</span>
        <span aria-hidden className="text-[0.65em] text-muted-foreground">
          &#9432;
        </span>
      </button>
      {open && (
        <span
          role="tooltip"
          id={popoverId}
          className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-left text-sm text-popover-foreground shadow-md"
        >
          <span className="block font-semibold mb-1">{entry.term}</span>
          <span className="block text-muted-foreground">{entry.shortDefinition}</span>
          {entry.fullDefinition && (
            <span className="mt-2 block text-muted-foreground">{entry.fullDefinition}</span>
          )}
          {entry.examples && entry.examples.length > 0 && (
            <span className="mt-2 block text-xs text-muted-foreground">
              <span className="font-medium">Examples:</span> {entry.examples.join(', ')}
            </span>
          )}
          {entry.learnMoreUrl && (
            <a
              href={entry.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-xs text-primary underline"
              onMouseDown={(e) => e.stopPropagation()}
            >
              Learn more
            </a>
          )}
        </span>
      )}
    </span>
  );
}

export default TermTooltip;
