import type { ReactNode } from 'react';
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
  return (
    <div
      className={cn(
        'relative min-w-0',
        editing && 'rounded-xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
      )}
      data-pill-id={id}
      data-testid={`pill-${id}`}
    >
      {children}
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
                type="button"
                aria-label={`Move ${label} earlier`}
                disabled={!canMoveUp}
                onClick={onMoveUp}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/80 text-muted-foreground hover:bg-muted disabled:opacity-30"
                data-testid={`pill-${id}-up`}
              >
                <ChevronUpIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${label} later`}
                disabled={!canMoveDown}
                onClick={onMoveDown}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/80 text-muted-foreground hover:bg-muted disabled:opacity-30"
                data-testid={`pill-${id}-down`}
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={onRemove}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/90 text-white hover:bg-red-500"
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
