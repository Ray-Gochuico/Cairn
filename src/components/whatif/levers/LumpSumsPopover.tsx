import LeverPopoverShell from './LeverPopoverShell';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

export default function LumpSumsPopover({ open, onOpenChange }: Props) {
  return (
    <LeverPopoverShell open={open} title="Lump-sum events" onOpenChange={onOpenChange} onApply={() => onOpenChange(false)} onReset={() => {}}>
      <p className="text-sm text-muted-foreground">Stub — implemented in Sub-Plan S-D Task 5.</p>
    </LeverPopoverShell>
  );
}
