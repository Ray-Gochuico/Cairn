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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useScenariosStore } from '@/stores/scenarios-store';

interface SaveCurrentDialogProps {
  defaultName: string;
  onClose: () => void;
  onSaved?: (newScenarioId: number) => void;
}

export function SaveCurrentDialog({
  defaultName,
  onClose,
  onSaved,
}: SaveCurrentDialogProps) {
  const { saveCurrentAsScenario } = useScenariosStore();
  const [name, setName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const disabled = trimmed === '' || submitting;

  async function handleSave() {
    if (disabled) return;
    setSubmitting(true);
    try {
      const newId = await saveCurrentAsScenario(trimmed);
      onSaved?.(newId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save current as scenario</DialogTitle>
          <DialogDescription className="sr-only">
            Save the current lever settings as a named scenario you can compare later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="save-current-name">Scenario name</Label>
          <Input
            id="save-current-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Snapshots the active scenario&apos;s current lever payload as a new scenario row.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SaveCurrentDialog;
