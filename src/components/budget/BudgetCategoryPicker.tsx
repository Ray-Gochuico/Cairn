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
import type { ParentGroup } from '@/lib/budget-analysis';

export type PickerOption = { id: number; name: string };

interface Props {
  /**
   * Grouped untracked categories. Each group renders as a small uppercase
   * parent-name header above its leaf checkboxes; the picker is a flat selection
   * model under the hood (selecting all leaves in a group flips the per-group
   * "(N/M selected)" indicator). Pass an empty array to hide the trigger.
   */
  groups: readonly ParentGroup[];
  onConfirm: (ids: number[]) => void;
}

export default function BudgetCategoryPicker({ groups, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  // Clear the in-flight selection whenever the picker closes (or there's
  // nothing left to pick from). Selection state must never persist between
  // open cycles — closing the picker discards any partial work.
  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);

  const totalOptions = groups.reduce((s, g) => s + g.options.length, 0);
  if (totalOptions === 0) return null;

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
        <div className="max-h-72 overflow-y-auto -mx-1 space-y-3">
          {groups.map((group) => {
            const selectedInGroup = group.options.filter((o) =>
              selected.includes(o.id),
            ).length;
            // Aria-labelledby ties the group's <h3> header to the role="group"
            // container so getByRole('group', { name: 'Home' }) finds it.
            const headingId = `picker-group-${group.parentId ?? 'general'}`;
            return (
              <div
                key={group.parentId ?? 'general'}
                role="group"
                aria-labelledby={headingId}
              >
                <div className="flex items-baseline justify-between border-b pb-1 mb-1 px-1">
                  <h3
                    id={headingId}
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {group.parentName}
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                    {selectedInGroup}/{group.options.length}
                  </span>
                </div>
                <div className="divide-y">
                  {group.options.map((opt) => {
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
              </div>
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
