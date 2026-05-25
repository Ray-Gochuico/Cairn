import LeverPopoverShell from './LeverPopoverShell';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

export default function ExtraLoanPaymentsPopover({ open, onOpenChange }: Props) {
  return (
    <LeverPopoverShell open={open} title="Extra loan payments" onOpenChange={onOpenChange} onApply={() => onOpenChange(false)} onReset={() => {}}>
      <p className="text-sm text-muted-foreground">Stub — implemented in Sub-Plan S-D Task 4.</p>
    </LeverPopoverShell>
  );
}
