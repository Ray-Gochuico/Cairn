import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { OverrideStatus, RoadmapNode } from '@/types/roadmap';

interface Props {
  node: RoadmapNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_CHOICES: { value: OverrideStatus; label: string; help: string }[] = [
  { value: 'done', label: 'Done', help: 'Mark as complete, regardless of inputs.' },
  { value: 'not-started', label: 'Not started', help: 'Reset to not started.' },
  { value: 'skipped', label: 'Skipped', help: 'Hide from progress counts.' },
];

/**
 * Modal that captures a per-node manual status override. Choices map
 * directly to the OverrideStatus enum (done / not-started / skipped);
 * the rule engine's full NodeStatus enum is intentionally narrowed for
 * users — overrides are an editorial pin, not a way to fake new
 * engine outputs.
 *
 * The note field is optional and free-form (200 char cap to keep the
 * audit table small). Saving writes through useRoadmapOverridesStore,
 * which re-reads on success so the parent drawer's `autoResult` channel
 * picks up the new override on the next render.
 */
export function OverrideDialog({ node, open, onOpenChange }: Props) {
  const setOverride = useRoadmapOverridesStore((s) => s.setOverride);
  const [status, setStatus] = useState<OverrideStatus>('done');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus('done');
      setNote('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setOverride(node.id, status, note.trim() ? note.trim() : null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save override.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override status</DialogTitle>
          <DialogDescription>{node.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-xs uppercase text-slate-500 tracking-wider">
              New status
            </legend>
            {STATUS_CHOICES.map((c) => (
              <label
                key={c.value}
                className="flex items-start gap-2 text-sm cursor-pointer"
              >
                <input
                  type="radio"
                  name="override-status"
                  value={c.value}
                  checked={status === c.value}
                  onChange={() => setStatus(c.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs text-slate-500 block">{c.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="text-xs uppercase text-slate-500 tracking-wider">
              Note (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              maxLength={200}
              rows={2}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
              placeholder="Why are you overriding this?"
            />
          </label>
          {error && (
            <div className="text-xs text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={submitting} onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OverrideDialog;
