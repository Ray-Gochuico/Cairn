import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EquityGrantForm, {
  DEFAULT_EQUITY_GRANT,
  type EquityGrantFormValues,
} from '@/components/forms/EquityGrantForm';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';

export interface AddEquityGrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal entry point for adding a new equity grant from the /equity-grants
 * visualization page (mirrors AddCategoryDialog's flow). Mounts the shared
 * EquityGrantForm inside a shadcn Dialog; on save, persists via
 * useEquityGrantsStore.create, shows a transient "✓ Added {name}" line, then
 * auto-closes after 800 ms.
 *
 * The dialog is self-sufficient — it triggers usePersonsStore.load() when
 * first opened so the owner picker always has options, even if the calling
 * page hasn't loaded persons yet.
 */
export default function AddEquityGrantDialog({
  open,
  onOpenChange,
}: AddEquityGrantDialogProps) {
  const create = useEquityGrantsStore((s) => s.create);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const [savedName, setSavedName] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defensive: ensure persons are loaded when the dialog opens so the owner
  // picker has options. The /equity-grants page already triggers this on
  // mount; doing it again is a no-op if persons are already loaded.
  useEffect(() => {
    if (open) {
      loadPersons();
    }
  }, [open, loadPersons]);

  // Clear pending close timer on unmount so we don't fire onOpenChange after
  // React has thrown the dialog away.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // When the dialog is closed by any means (Cancel, ESC, backdrop click),
  // reset the saved-name flash so reopening shows the form again.
  useEffect(() => {
    if (!open && savedName != null) {
      setSavedName(null);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }
  }, [open, savedName]);

  const personOptions = persons
    .filter((p): p is typeof p & { id: number } => p.id != null)
    .map((p) => ({ id: p.id, name: p.name }));

  const handleSave = async (data: EquityGrantFormValues) => {
    await create(data);
    setSavedName(data.name);
    closeTimerRef.current = setTimeout(() => {
      setSavedName(null);
      onOpenChange(false);
      closeTimerRef.current = null;
    }, 800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add equity grant</DialogTitle>
        </DialogHeader>
        {savedName ? (
          <p
            role="status"
            className="py-6 text-center text-sm font-medium text-green-600 dark:text-green-400"
            data-testid="add-equity-grant-success"
          >
            ✓ Added {savedName}
          </p>
        ) : (
          <EquityGrantForm
            initial={DEFAULT_EQUITY_GRANT}
            persons={personOptions}
            onSubmit={handleSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
