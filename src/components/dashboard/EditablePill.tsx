import { useEffect, useRef, type ReactNode } from 'react';
import { GripVerticalIcon, XIcon, ChevronUpIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EditablePillProps {
  /** Stable identifier used by the layout hook to track this pill. */
  id: string;
  /** Human-readable label for the remove/move buttons' aria attributes. */
  label: string;
  editing: boolean;
  /** Hides the up button when this is the first pill. */
  canMoveUp: boolean;
  /** Hides the down button when this is the last pill. */
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}

/**
 * Edit-mode wrapper around a dashboard pill. When `editing` is false this is
 * a transparent passthrough — the underlying MetricCard / ConcentrationCard
 * is responsible for its own click target (Link href). When `editing` is
 * true, click targets inside `children` are suppressed via a covering shield
 * so the user's clicks land on the move/remove buttons instead, and a grip
 * + remove (X) + up/down arrows surface as overlays.
 */
export function EditablePill({
  id,
  label,
  editing,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: EditablePillProps) {
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  // When a click causes the clicked move button to disable (item reached
  // the list boundary), the browser drops focus to <body>. Queue the
  // intent in the click handler; after the re-render, hand focus to the
  // counterpart so keyboard users stay in the toolbar.
  const pendingRefocusRef = useRef<'up' | 'down' | null>(null);
  useEffect(() => {
    const pending = pendingRefocusRef.current;
    pendingRefocusRef.current = null;
    if (pending === 'up' && !canMoveUp) downRef.current?.focus();
    else if (pending === 'down' && !canMoveDown) upRef.current?.focus();
  });

  return (
    <div
      className={cn(
        'relative min-w-0',
        editing && 'rounded-lg ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
      )}
      data-pill-id={id}
      data-testid={`pill-${id}`}
    >
      {/* Wave-4 a11y: `inert` removes the pill body (usually a Link) from
          the tab order and the accessibility tree while editing — the
          aria-hidden click shield below only stops the mouse. React 19
          renders the boolean prop as the HTML attribute. */}
      <div inert={editing} data-testid={`pill-${id}-content`}>
        {children}
      </div>
      {editing ? (
        <>
          {/*
           * Click shield — absorbs taps on the inner Link so they don't
           * navigate while in edit mode. Sits below the toolbar overlays
           * via z-index so the buttons stay tappable.
           */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-10 cursor-default"
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            data-testid={`pill-${id}-shield`}
          />
          <div className="absolute inset-x-1 top-1 z-20 flex items-center justify-between gap-1">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/80 text-muted-foreground"
              data-testid={`pill-${id}-grip`}
            >
              <GripVerticalIcon className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-center gap-1">
              <button
                ref={upRef}
                type="button"
                aria-label={`Move ${label} earlier`}
                disabled={!canMoveUp}
                onClick={() => {
                  pendingRefocusRef.current = 'up';
                  onMoveUp();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/80 text-muted-foreground hover:bg-muted disabled:opacity-30"
                data-testid={`pill-${id}-up`}
              >
                <ChevronUpIcon className="h-3.5 w-3.5" />
              </button>
              <button
                ref={downRef}
                type="button"
                aria-label={`Move ${label} later`}
                disabled={!canMoveDown}
                onClick={() => {
                  pendingRefocusRef.current = 'down';
                  onMoveDown();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/80 text-muted-foreground hover:bg-muted disabled:opacity-30"
                data-testid={`pill-${id}-down`}
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={onRemove}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-destructive/90 text-destructive-foreground hover:bg-destructive"
                data-testid={`pill-${id}-remove`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
