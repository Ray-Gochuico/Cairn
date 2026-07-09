import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface LeverPopoverShellProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onOpenChange: (next: boolean) => void;
  onApply: () => void;
  onReset: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
}

export default function LeverPopoverShell({
  open, title, children, onOpenChange, onApply, onReset, applyDisabled, applyLabel,
}: LeverPopoverShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Adjust this lever’s assumptions; changes apply to the active scenario.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">{children}</div>
        <DialogFooter className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>↺ Reset</Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={onApply} disabled={applyDisabled}>
            {applyLabel ?? 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
