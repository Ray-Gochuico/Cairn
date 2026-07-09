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

interface RenameScenarioDialogProps {
  scenarioId: number;
  initialName: string;
  onClose: () => void;
}

export function RenameScenarioDialog({
  scenarioId,
  initialName,
  onClose,
}: RenameScenarioDialogProps) {
  const { rename } = useScenariosStore();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const disabled = trimmed === '' || submitting;

  async function handleSave() {
    if (disabled) return;
    setSubmitting(true);
    try {
      await rename(scenarioId, trimmed);
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
          <DialogTitle>Rename scenario</DialogTitle>
          <DialogDescription className="sr-only">
            Type a new name for this scenario.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="rename-scenario-name">Scenario name</Label>
          <Input
            id="rename-scenario-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
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

export default RenameScenarioDialog;
