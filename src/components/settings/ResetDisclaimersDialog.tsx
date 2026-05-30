import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useHouseholdStore } from '@/stores/household-store';
import { getDatabase } from '@/db/db';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Debug confirmation dialog for the "Reset disclaimers" button in
 * Settings → Advanced. Clears this household's rows in
 * disclosure_acceptances — the single source of truth the gate reads
 * (MF-1 + T5) — then refreshes the in-memory acceptances projection so
 * every gate (app_wide at next launch, Roadmap + Learn next time those
 * pages open) re-prompts. There are no legacy household cache columns to
 * null (they were dropped in 0043).
 *
 * Failure surfacing matches OverrideDialog: in-line `role="alert"`
 * line, save button disabled while in flight to prevent double-fire.
 */
export function ResetDisclaimersDialog({ open, onOpenChange }: Props) {
  const householdId = useHouseholdStore((s) => s.household?.id ?? 1);
  const loadAcceptances = useAcceptancesStore((s) => s.load);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // disclosure_acceptances is the single source of truth the gate reads
      // (MF-1 + T5). Clear this household's rows, then refresh the in-memory
      // cache so every gate (app_wide, roadmap, learning, …) re-prompts.
      await new DisclosureAcceptancesRepo(getDatabase()).clearForHousehold(householdId);
      await loadAcceptances();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset disclaimers.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset disclaimer acceptances?</DialogTitle>
          <DialogDescription>
            Clears this household's disclosure acceptances. The app-wide
            disclaimer reappears on next launch; the Roadmap and Learn
            disclaimers reappear next time you open those pages.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          This resets your recorded acceptances for testing — every disclosure
          gate will re-prompt. It does not affect any other data.
        </p>
        {error && (
          <div className="text-xs text-destructive-soft-foreground" role="alert">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={handleConfirm}
          >
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ResetDisclaimersDialog;
