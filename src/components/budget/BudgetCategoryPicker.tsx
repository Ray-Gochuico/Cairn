import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type PickerOption = { id: number; name: string };

interface Props {
  untracked: readonly PickerOption[];
  onConfirm: (ids: number[]) => void;
}

export default function BudgetCategoryPicker({ untracked, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  // Clear the in-flight selection whenever the picker closes (or there's
  // nothing left to pick from). Selection state must never persist between
  // open cycles — closing the picker discards any partial work.
  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);

  if (untracked.length === 0) return null;

  const toggle = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const applyDisabled = selected.length === 0;
  const applyLabel =
    selected.length === 1 ? 'Add 1 category' : `Add ${selected.length} categories`;

  const handleApply = () => {
    onConfirm([...selected]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          + Add categories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add categories to track</DialogTitle>
          <DialogDescription>
            Check every category you want to add to the budget overlay.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto -mx-1 divide-y">
          {untracked.map((opt) => {
            const checked = selected.includes(opt.id);
            return (
              <label
                key={opt.id}
                className="flex items-center gap-3 px-1 py-2 text-sm cursor-pointer hover:bg-accent/50 rounded-sm"
              >
                <input
                  type="checkbox"
                  aria-label={opt.name}
                  checked={checked}
                  onChange={() => toggle(opt.id)}
                  className="h-4 w-4"
                />
                <span>{opt.name}</span>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={applyDisabled}
            onClick={handleApply}
          >
            {applyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
