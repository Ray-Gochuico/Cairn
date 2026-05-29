import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardEditFrameProps {
  label: string;
  hidden: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleHidden: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: ReactNode;
}

/**
 * Edit-mode wrapper shown around each Investments card while "Customize" is on.
 * A control strip (label · ↑ · ↓ · Hide/Show) sits above the card; hidden cards
 * render greyed so the user can still see and re-show them. Mirrors the
 * arrow/Hide affordances of Settings → Sidebar (SidebarSection).
 */
export default function CardEditFrame({
  label,
  hidden,
  canMoveUp,
  canMoveDown,
  onToggleHidden,
  onMoveUp,
  onMoveDown,
  children,
}: CardEditFrameProps) {
  return (
    <div className="rounded-lg border border-dashed">
      <div className="flex items-center gap-2 border-b border-dashed px-3 py-1.5 text-sm">
        <span className={cn('flex-1 font-medium', hidden && 'text-muted-foreground line-through')}>
          {label}
        </span>
        <button
          type="button"
          aria-label={`Move ${label} up`}
          className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          ▼
        </button>
        <button
          type="button"
          aria-label={`${hidden ? 'Show' : 'Hide'} ${label}`}
          className="rounded border px-2 text-xs hover:bg-muted"
          onClick={onToggleHidden}
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
      </div>
      <div className={cn('p-3', hidden && 'opacity-40')}>{children}</div>
    </div>
  );
}
