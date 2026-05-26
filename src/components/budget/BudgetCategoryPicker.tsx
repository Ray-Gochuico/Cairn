import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AddCategoryDialog, {
  type AddCategoryPayload,
} from '@/components/budget/AddCategoryDialog';
import type { ParentGroup } from '@/lib/budget-analysis';
import type { Category } from '@/types/schema';

export type PickerOption = { id: number; name: string };

interface Props {
  /**
   * Grouped untracked categories. Each group renders as a small uppercase
   * parent-name header above its leaf checkboxes; the picker is a flat selection
   * model under the hood (selecting all leaves in a group flips the per-group
   * "(N/M selected)" indicator). May be empty: when `onCreateCategory` is set,
   * the trigger still renders so the user can reach the "+ Add category" flow
   * from an all-tracked household. With no callback and zero groups, the
   * picker renders nothing (back-compat).
   */
  groups: readonly ParentGroup[];
  onConfirm: (ids: number[]) => void;
  /**
   * All persisted categories — passed to AddCategoryDialog for the parent
   * <select>. The picker filters this to top-level NEED/WANT/SAVINGS parents
   * itself; pass the unfiltered list. Required when onCreateCategory is set.
   */
  parents?: ReadonlyArray<Category>;
  /**
   * When provided, renders an inline "+ Add category" button at the bottom of
   * the picker dialog. Save → invokes this with the dialog's payload and the
   * caller is responsible for persisting + appending to the tracked list.
   * If omitted, the "+ Add category" trigger is not rendered (back-compat).
   */
  onCreateCategory?: (payload: AddCategoryPayload) => void;
}

export default function BudgetCategoryPicker({
  groups,
  onConfirm,
  parents,
  onCreateCategory,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Clear in-flight selection AND the search query whenever the picker closes
  // (or there's nothing left to pick from). Selection state must never persist
  // between open cycles — closing the picker discards any partial work.
  useEffect(() => {
    if (!open) {
      setSelected([]);
      setQuery('');
    }
  }, [open]);

  // Case-insensitive substring filter over leaf names. Filtering hides parent
  // headers whose children are all filtered out, but does NOT mutate the
  // selection — toggling a check, then narrowing the filter, then widening it
  // again must re-reveal the still-checked leaf with its check intact.
  // NOTE: must run BEFORE any early return so Rules of Hooks holds.
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (normalizedQuery === '') return groups;
    const result: ParentGroup[] = [];
    for (const g of groups) {
      const matching = g.options.filter((o) =>
        o.name.toLowerCase().includes(normalizedQuery),
      );
      if (matching.length > 0) {
        result.push({ ...g, options: matching });
      }
    }
    return result;
  }, [groups, normalizedQuery]);

  const totalOptions = groups.reduce((s, g) => s + g.options.length, 0);
  // When there's nothing pickable AND no create-category callback, the picker
  // has no purpose — render nothing (back-compat). When `onCreateCategory` is
  // set, we keep rendering the trigger so the user can reach the "+ Add
  // category" flow even when every category is already tracked.
  if (totalOptions === 0 && onCreateCategory == null) return null;

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

  // Empty-state copy when every category is tracked AND the create-category
  // callback is wired up. The picker still opens (via the always-rendered
  // trigger), shows this message, and exposes the "+ Add category" entry.
  const allTracked = totalOptions === 0;

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
            {allTracked
              ? 'All categories are tracked. Add a new one below.'
              : 'Check every category you want to add to the budget overlay.'}
          </DialogDescription>
        </DialogHeader>

        {!allTracked && (
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories"
            aria-label="Search categories"
          />
        )}

        {!allTracked && (
          <div className="max-h-72 overflow-y-auto -mx-1 space-y-3">
            {visibleGroups.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No categories match "{query}".
              </p>
            ) : (
              visibleGroups.map((group) => {
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
              })
            )}
          </div>
        )}
        {onCreateCategory != null && (
          <div className="pt-3 border-t mt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setAddOpen(true)}
            >
              + Add category
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          {!allTracked && (
            <Button
              type="button"
              size="sm"
              disabled={applyDisabled}
              onClick={handleApply}
            >
              {applyLabel}
            </Button>
          )}
        </div>
      </DialogContent>
      {onCreateCategory != null && (
        <AddCategoryDialog
          open={addOpen}
          parents={(parents ?? []).filter(
            (p) =>
              p.parentCategoryId == null &&
              (p.type === 'NEED' || p.type === 'WANT' || p.type === 'SAVINGS'),
          )}
          onSave={(payload) => {
            onCreateCategory(payload);
            setAddOpen(false);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Dialog>
  );
}
