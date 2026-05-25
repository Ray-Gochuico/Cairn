import LeverPopoverShell from './LeverPopoverShell';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

export default function IncomePopover({ open, onOpenChange }: Props) {
  return (
    <LeverPopoverShell open={open} title="Income / raises" onOpenChange={onOpenChange} onApply={() => onOpenChange(false)} onReset={() => {}}>
      <p className="text-sm text-muted-foreground">Stub — implemented in Sub-Plan S-D Task 8.</p>
    </LeverPopoverShell>
  );
}
