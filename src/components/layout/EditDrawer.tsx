import type { ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface EditDrawerProps {
  open: boolean;
  /** Fired for EVERY dismissal path (Escape, X, Cancel wiring). */
  onClose: () => void;
  title: string;
  /** Visible one-liner under the title. Omitted → an sr-only fallback keeps
   * Radix's Description requirement satisfied without visual noise. */
  description?: string;
  /** Dense manage forms (Holdings/Contributions) get the wide variant. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Wave-14 "one place per thing": the single edit surface for entity CRUD on
 * analysis pages. A right-side Sheet (Radix dialog → focus trap, Escape,
 * scroll lock, focus restore) that mounts the existing presentational forms
 * (src/components/forms/*) UNCHANGED — the page keeps owning persistence via
 * its store, exactly like the Inputs tabs did.
 *
 * Dismissal policy (W14 decision #2): outside-click is prevented — a click on
 * the dimmed analysis behind a half-filled form must not eat the user's
 * typing (the Wave-10 T35 lesson). Escape and the X remain; the form's own
 * Cancel button calls onClose.
 *
 * NOT for record-level quick actions — those keep their Dialogs
 * (TransactionEditDialog, UpdateAccountBalanceDialog, …).
 */
export function EditDrawer({ open, onClose, title, description, wide = false, children }: EditDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className={cn('w-full overflow-y-auto', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="mt-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
