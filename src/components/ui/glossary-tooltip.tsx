import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
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
 * Hover and focus open the popover (delayed close on hover-out so the
 * cursor can travel into the popover without it disappearing); click
 * toggles for keyboard / touch users; tapping outside or pressing
 * Escape closes it.
 *
 * Internal implementation is `@radix-ui/react-popover`. Radix handles
 * flip / shift positioning at viewport edges, focus management
 * (content gets focus on keyboard open, focus returns to trigger on
 * close), Tab / Shift-Tab inside, Escape closes, click-outside closes.
 * The content keeps Radix's default `role="dialog"` (Wave-4 a11y:
 * the tooltip role forbids interactive content, and this popover holds
 * the "Learn more" link). The popover *can* hold focus — Tab into the
 * "Learn more" link is supported.
 *
 * Definitions live in `src/lib/glossary.ts`. If a term isn't in the
 * glossary, the wrapper falls back to a plain inline span (no UI nag)
 * and logs a dev-mode warning so the missing entry surfaces in CI.
 */
export function TermTooltip({ term, children, className }: TermTooltipProps) {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  // Debounce the hover-out so users can travel the cursor from trigger
  // into the popover (a few px of dead space between them) without the
  // popover disappearing. 120 ms is the same delay the Radix HoverCard
  // primitive uses by default.
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

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
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          // Hover opens immediately; mouse-leave schedules a delayed
          // close so the user can move the cursor into the popover
          // without it disappearing. Click toggles. The trick: Radix's
          // composed click handler reads the controlled `open` to
          // decide toggle direction, but hover may have just set
          // `open=true` in the *same* event sequence (user-event v14's
          // click fires pointerenter → click). We pre-empt Radix's
          // toggle by reading `open` ourselves and forcing the right
          // direction; `preventDefault` stops Radix's `onOpenToggle`
          // from running afterward (composeEventHandlers skips when
          // defaultPrevented).
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
          onClick={(e) => {
            // We own click semantics: clicking always opens (matches
            // hover/focus). Closing happens via Escape, click-outside,
            // or mouse-leave from both trigger and popover. This
            // prevents the user-event v14 click race where
            // pointerenter opens then Radix's toggle would immediately
            // close.
            e.preventDefault();
            cancelClose();
            setOpen(true);
          }}
          className={cn(
            'inline-flex items-baseline gap-0.5 underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm bg-transparent cursor-help',
            className,
          )}
        >
          <span>{children ?? entry.term}</span>
          <span aria-hidden className="text-[0.65em] text-muted-foreground">
            &#9432;
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          // Wave-4 a11y: no role override — Radix's default role="dialog"
          // is the truthful role; the tooltip role forbids the interactive
          // "Learn more" link this popover contains.
          sideOffset={6}
          collisionPadding={8}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          // Radix tries to focus the content on open via keyboard. The
          // tooltip is informational — keep focus on the trigger so
          // sighted-keyboard users see the dotted underline indicator,
          // but still allow Tab to move into the popover (Learn more
          // link). `event.preventDefault()` in onOpenAutoFocus keeps
          // focus on the trigger; Tab still works since Radix wires up
          // its own focus-trap-on-content.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-72 rounded-md border bg-popover px-3 py-2 text-left text-sm text-popover-foreground shadow-md outline-none"
        >
          <div className="font-semibold mb-1">{entry.term}</div>
          <div className="text-muted-foreground">{entry.shortDefinition}</div>
          {entry.fullDefinition && (
            <div className="mt-2 text-muted-foreground">{entry.fullDefinition}</div>
          )}
          {entry.examples && entry.examples.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Examples:</span> {entry.examples.join(', ')}
            </div>
          )}
          {entry.learnMoreUrl && (
            <a
              href={entry.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-xs text-primary underline"
            >
              Learn more
            </a>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export default TermTooltip;
