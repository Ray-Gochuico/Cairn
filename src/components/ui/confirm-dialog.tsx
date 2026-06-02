import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Short, specific question, e.g. "Delete this account?". */
  title: string;
  /**
   * What the action does and that it is irreversible. For high-cascade
   * deletes (Account, Person) name the collateral that goes with it.
   */
  description: React.ReactNode;
  /** Destructive button label. Defaults to "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Fired when the user clicks the destructive confirm button. */
  onConfirm: () => void;
  /**
   * Fired when the user cancels — via the Cancel button, the X, Escape,
   * or an overlay click. Always called exactly once per dismissal that
   * is not a confirm.
   */
  onCancel: () => void;
}

/**
 * A controlled confirmation dialog built on the shared Radix Dialog. It
 * inherits the Dialog's focus trap and Escape-to-close for free; any
 * non-confirm dismissal routes through `onCancel`. The confirm button uses
 * the Button `destructive` variant so it reads as a dangerous action.
 *
 * Most call sites should prefer the `useConfirm()` hook below, which wraps
 * this component in a promise-returning `confirm()` so a delete handler can
 * `await` the user's decision inline. This raw component is exported for
 * cases that want to own the open/answer state themselves.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix flips this to false on Escape / overlay click / X. Any
        // close that wasn't the explicit confirm is treated as a cancel.
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

/**
 * Promise-based confirmation. Returns:
 *   - `confirm(opts)` → opens the dialog and resolves `true` on confirm,
 *     `false` on any cancel/dismiss.
 *   - `dialog` → the element to render once in the component (it portals
 *     itself, so placement in the tree doesn't matter).
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   onClick={async () => { if (await confirm({ title, description })) remove(id); }}
 *   ...
 *   return (<>{dialog}{rest}</>);
 *
 * The pending resolver is held in a ref so sequential confirms never leak
 * a stale resolver, and resolving a no-longer-pending dialog is a no-op.
 */
export function useConfirm() {
  const [state, setState] = React.useState<ConfirmState>({
    open: false,
    title: '',
    description: '',
  });
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const settle = React.useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState((s) => ({ ...s, open: false }));
    resolve?.(value);
  }, []);

  const confirm = React.useCallback(
    (opts: ConfirmOptions): Promise<boolean> => {
      // If a previous confirm is somehow still pending, resolve it false
      // before starting a new one so its awaiter doesn't hang forever.
      if (resolverRef.current) {
        const prev = resolverRef.current;
        resolverRef.current = null;
        prev(false);
      }
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setState({ open: true, ...opts });
      });
    },
    [],
  );

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}
