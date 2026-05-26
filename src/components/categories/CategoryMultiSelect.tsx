import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Category } from '@/types/schema';

export interface CategoryMultiSelectProps {
  categories: Category[];
  selected: number[];
  onChange: (ids: number[]) => void;
  /** Picker button label, e.g. "Utilities categories". */
  label: string;
  /** Optional predicate on top of the default "leaf categories only" rule. */
  filterFn?: (c: Category) => boolean;
}

interface ParentGroup {
  parentId: number | null;
  parentName: string;
  leaves: Category[];
}

function isLeafCategory(c: Category, parentIds: Set<number>): boolean {
  return c.id != null && !parentIds.has(c.id);
}

function buildParentIdSet(categories: Category[]): Set<number> {
  return new Set(
    categories
      .map((c) => c.parentCategoryId)
      .filter((id): id is number => id != null),
  );
}

function leafSelector(
  categories: Category[],
  filterFn?: (c: Category) => boolean,
): (c: Category) => boolean {
  const parentIds = buildParentIdSet(categories);
  return (c) => isLeafCategory(c, parentIds) && (filterFn ? filterFn(c) : true);
}

function groupByParent(
  categories: Category[],
  filterFn?: (c: Category) => boolean,
  search?: string,
): ParentGroup[] {
  const isLeaf = leafSelector(categories, filterFn);
  const norm = (s: string) => s.toLowerCase();
  const matchesSearch = (c: Category) =>
    !search || norm(c.name).includes(norm(search));

  const leaves = categories.filter((c) => isLeaf(c) && matchesSearch(c));

  const groups = new Map<number | null, ParentGroup>();
  for (const leaf of leaves) {
    const parentId = leaf.parentCategoryId ?? null;
    const parentName =
      parentId == null
        ? '(uncategorized)'
        : (categories.find((c) => c.id === parentId)?.name ?? '(unknown parent)');
    const existing = groups.get(parentId);
    if (existing) {
      existing.leaves.push(leaf);
    } else {
      groups.set(parentId, { parentId, parentName, leaves: [leaf] });
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.parentName.localeCompare(b.parentName),
  );
}

/**
 * Generic multi-select popover for choosing a subset of categories.
 *
 * Renders a Button labeled `${label} (N/M)`. Click opens a popover with:
 *   - search input,
 *   - Show all / Hide all link pair,
 *   - parent-grouped checkboxes for leaf categories.
 *
 * Used by both the Settings → Advanced "Property & Vehicle stat categories"
 * block and the inline pencil-popover on Property/Vehicle cards.
 *
 * Generic on purpose: takes `categories` + `selected` + `onChange` as
 * props — no store coupling so it's straightforward to unit-test.
 */
export function CategoryMultiSelect({
  categories,
  selected,
  onChange,
  label,
  filterFn,
}: CategoryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allLeaves = useMemo(() => {
    const isLeaf = leafSelector(categories, filterFn);
    return categories.filter(isLeaf);
  }, [categories, filterFn]);

  const groups = useMemo(
    () => groupByParent(categories, filterFn, search),
    [categories, filterFn, search],
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (allLeaves.length === 0) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        aria-label={`${label} — no categories available`}
      >
        {label} (no categories)
      </Button>
    );
  }

  const showAll = () =>
    onChange(allLeaves.map((c) => c.id as number));
  const hideAll = () => onChange([]);
  const toggle = (id: number) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {label} ({selectedSet.size}/{allLeaves.length})
      </Button>
      {open && (
        <>
          <div
            data-testid="category-picker-backdrop"
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={`${label} picker`}
            className="absolute right-0 top-full mt-2 w-72 rounded-md border bg-background shadow-lg p-2 z-20"
          >
            <div className="px-1.5 pb-2 mb-1 border-b space-y-2">
              <Input
                aria-label="Search categories"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={showAll}
                >
                  Show all
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={hideAll}
                >
                  Hide all
                </Button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-3">
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2">
                  No matching categories.
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.parentId ?? 'root'}>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground px-1.5 pb-1">
                      {g.parentName}
                    </div>
                    <ul className="space-y-1">
                      {g.leaves.map((leaf) => {
                        const id = leaf.id as number;
                        const checked = selectedSet.has(id);
                        const inputId = `cat-pick-${label.replace(/\s/g, '-')}-${id}`;
                        return (
                          <li
                            key={id}
                            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent"
                          >
                            <input
                              id={inputId}
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(id)}
                              className="h-4 w-4 cursor-pointer"
                            />
                            <label
                              htmlFor={inputId}
                              className="text-sm cursor-pointer flex-1 truncate"
                            >
                              {leaf.name}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
