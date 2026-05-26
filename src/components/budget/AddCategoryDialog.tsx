import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
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
  const [type, setType] = useState<'NEED' | 'WANT'>(CategoryType.NEED);

  const noParents = parents.length === 0;
  const canSave = !noParents && name.trim().length > 0 && parentId !== '';

  const reset = () => {
    setName('');
    setParentId('');
    setType(CategoryType.NEED);
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      parentCategoryId: parentId as number,
      type,
      color: null,
      icon: null,
      isCapital: false,
      monthlyBudget: null,
    });
    reset();
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
              <select
                id="add-cat-parent"
                className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                value={parentId === '' ? '' : String(parentId)}
                onChange={(e) =>
                  setParentId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">Choose a parent…</option>
                {parents.map((p) => (
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
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
