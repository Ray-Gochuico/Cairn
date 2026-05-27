import type { ReactNode } from 'react';
import { GripVerticalIcon, XIcon, ChevronUpIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EditableWidgetProps {
  id: string;
  label: string;
  editing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}

/**
 * Edit-mode wrapper around a whole-row dashboard widget (spending donut,
 * concentration card, goals strip, etc.). Mirrors the EditablePill UX:
 * a click shield absorbs interaction while editing, and a floating toolbar
 * surfaces move/remove controls. The toolbar sits flush to the top edge so
 * it never overlaps the underlying widget's own headline content.
 */
export function EditableWidget({
  id,
  label,
  editing,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: EditableWidgetProps) {
  return (
    <div
      className={cn(
        'relative min-w-0',
        editing && 'rounded-xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
      )}
      data-widget-id={id}
      data-testid={`widget-${id}`}
    >
      {children}
      {editing ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 z-10 cursor-default"
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            data-testid={`widget-${id}-shield`}
          />
          <div className="absolute inset-x-2 top-2 z-20 flex items-center justify-between gap-1">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/90 text-muted-foreground shadow"
              data-testid={`widget-${id}-grip`}
            >
              <GripVerticalIcon className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move ${label} up`}
                disabled={!canMoveUp}
                onClick={onMoveUp}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/90 text-muted-foreground shadow hover:bg-muted disabled:opacity-30"
                data-testid={`widget-${id}-up`}
              >
                <ChevronUpIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${label} down`}
                disabled={!canMoveDown}
                onClick={onMoveDown}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/90 text-muted-foreground shadow hover:bg-muted disabled:opacity-30"
                data-testid={`widget-${id}-down`}
              >
                <ChevronDownIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Hide ${label}`}
                onClick={onRemove}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive/90 text-destructive-foreground shadow hover:bg-destructive"
                data-testid={`widget-${id}-remove`}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
