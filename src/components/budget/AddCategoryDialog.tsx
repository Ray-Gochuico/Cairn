import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CategoryType } from '@/types/enums';
import type { Category } from '@/types/schema';

/**
 * Payload shape passed to onSave. Mirrors the subset of CategorySchema fields
 * needed to create a budgetable leaf category — color/icon/isCapital/budget
 * are deferred to Inputs → Categories (see spec).
 */
export interface AddCategoryPayload {
  name: string;
  parentCategoryId: number;
  type: 'NEED' | 'WANT';
  color: null;
  icon: null;
  isCapital: false;
  monthlyBudget: null;
}

export interface AddCategoryDialogProps {
  open: boolean;
  /**
   * Already-filtered list of valid parent categories. The dialog renders this
   * verbatim — its caller (BudgetCategoryPicker) is responsible for filtering
   * to top-level budgetable parents (parentCategoryId == null && type ∈
   * {NEED, WANT, SAVINGS}).
   */
  parents: ReadonlyArray<Category>;
  onSave: (payload: AddCategoryPayload) => void;
  onClose: () => void;
}

export default function AddCategoryDialog({
  open,
  parents,
  onSave,
  onClose,
}: AddCategoryDialogProps) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<number | ''>('');
  const [parentQuery, setParentQuery] = useState('');
  const [type, setType] = useState<'NEED' | 'WANT'>(CategoryType.NEED);
  const [justSavedName, setJustSavedName] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noParents = parents.length === 0;
  const canSave = !noParents && name.trim().length > 0 && parentId !== '';

  // Case-insensitive substring filter on the parent <select>. The placeholder
  // "Choose a parent…" row is always present, plus any parent whose name
  // contains the query. Selecting a parent then narrowing the filter past it
  // leaves the selection intact — the filter is purely visual.
  const filteredParents = useMemo(() => {
    const q = parentQuery.trim().toLowerCase();
    if (q === '') return parents;
    return parents.filter((p) => p.name.toLowerCase().includes(q));
  }, [parents, parentQuery]);

  const reset = () => {
    setName('');
    setParentId('');
    setParentQuery('');
    setType(CategoryType.NEED);
    setJustSavedName(null);
  };

  // Clean up the auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleSave = () => {
    if (!canSave) return;
    const savedName = name.trim();
    onSave({
      name: savedName,
      parentCategoryId: parentId as number,
      type,
      color: null,
      icon: null,
      isCapital: false,
      monthlyBudget: null,
    });
    // Show transient success then auto-close after 800 ms
    setJustSavedName(savedName);
    closeTimerRef.current = setTimeout(() => {
      reset();
      onClose();
    }, 800);
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add category</DialogTitle>
          <DialogDescription>
            Name a new spending category; it becomes available for transactions and budgets right away.
          </DialogDescription>
        </DialogHeader>

        {noParents ? (
          <p className="text-sm text-muted-foreground">
            Add a parent category in{' '}
            <Link to="/inputs/categories" className="underline">
              Inputs → Categories
            </Link>{' '}
            first.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="add-cat-name">Name</Label>
              <Input
                id="add-cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="add-cat-parent">Parent</Label>
              {parents.length > 1 && (
                <Input
                  id="add-cat-parent-search"
                  type="search"
                  value={parentQuery}
                  onChange={(e) => setParentQuery(e.target.value)}
                  placeholder="Filter…"
                  // Aria label intentionally avoids the word "parent" so the
                  // existing `getByLabelText(/parent/i)` lookups for the select
                  // resolve uniquely. UX-clear because the field is visually
                  // adjacent to the "Parent" <Label>.
                  aria-label="Filter list"
                  className="mb-1"
                />
              )}
              <select
                id="add-cat-parent"
                className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                value={parentId === '' ? '' : String(parentId)}
                onChange={(e) =>
                  setParentId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">Choose a parent…</option>
                {filteredParents.map((p) => (
                  <option key={p.id} value={p.id!}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={type === 'NEED' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setType('NEED')}
                >
                  Need
                </Button>
                <Button
                  type="button"
                  variant={type === 'WANT' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setType('WANT')}
                >
                  Want
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {justSavedName ? (
            <p
              role="status"
              className="text-sm font-medium text-success-foreground"
              data-testid="add-category-success"
            >
              ✓ Added {justSavedName}
            </p>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!canSave}>
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
