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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Debug confirmation dialog for the "Reset disclaimers" button in
 * Settings → Advanced. Clears the fast-path acceptance columns on the
 * household so the gates re-trigger at next app launch (app_wide) and
 * next Roadmap open (roadmap). The disclosure_acceptances audit table
 * is intentionally untouched — those rows are historical record, not
 * cache.
 *
 * Failure surfacing matches OverrideDialog: in-line `role="alert"`
 * line, save button disabled while in flight to prevent double-fire.
 */
export function ResetDisclaimersDialog({ open, onOpenChange }: Props) {
  const update = useHouseholdStore((s) => s.update);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await update({
        disclaimerAcceptedAt: null,
        disclaimerVersionAccepted: null,
        roadmapDisclaimerAcceptedAt: null,
        roadmapDisclaimerVersionAccepted: null,
      });
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
            Clears your accepted-version flags. The app-wide disclaimer will
            reappear on next launch; the Roadmap disclaimer will reappear
            next time you open the Roadmap.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          The audit log of past acceptances is preserved — only the
          fast-path cache is cleared.
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
