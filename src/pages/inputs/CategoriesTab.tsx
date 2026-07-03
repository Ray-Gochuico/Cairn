import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { CategoryType } from '@/types/enums';
import { CategorySchema } from '@/types/schema';
import type { Category } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CategoryFormSchema = CategorySchema.omit({ id: true, systemManaged: true });
type CategoryFormValues = z.infer<typeof CategoryFormSchema>;

const DEFAULT_VALUES: CategoryFormValues = {
  name: '',
  parentCategoryId: null,
  color: null,
  icon: null,
  type: 'WANT',
  isCapital: false,
  monthlyBudget: null,
};

const CATEGORY_TYPE_OPTIONS = [
  { value: CategoryType.NEED, label: 'Need' },
  { value: CategoryType.WANT, label: 'Want' },
  { value: CategoryType.SAVINGS, label: 'Savings' },
  { value: CategoryType.INCOME, label: 'Income' },
  { value: CategoryType.TRANSFER, label: 'Transfer' },
];

interface CategoryFormProps {
  initial: CategoryFormValues;
  parents: Category[];
  onSubmit: (v: CategoryFormValues) => Promise<void>;
  onCancel: () => void;
}

function CategoryForm({ initial, parents, onSubmit, onCancel }: CategoryFormProps) {
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(CategoryFormSchema),
    defaultValues: DEFAULT_VALUES,
    values: initial,
  });

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" {...form.register('name')} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="cat-type">Type</Label>
          <select
            id="cat-type"
            className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={form.watch('type')}
            onChange={(e) =>
              form.setValue('type', e.target.value as CategoryFormValues['type'], {
                shouldDirty: true,
                shouldTouch: true,
              })
            }
          >
            {CATEGORY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cat-parent">Parent category</Label>
          <select
            id="cat-parent"
            className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={form.watch('parentCategoryId') ?? ''}
            onChange={(e) =>
              form.setValue(
                'parentCategoryId',
                e.target.value === '' ? null : Number(e.target.value),
                { shouldDirty: true, shouldTouch: true },
              )
            }
          >
            <option value="">None (top-level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cat-color">Color</Label>
          <Input id="cat-color" {...form.register('color')} placeholder="#hex or blank" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="cat-icon">Icon (emoji)</Label>
          <Input id="cat-icon" {...form.register('icon')} placeholder="e.g. 🍔" />
        </div>

        <div className="flex items-center gap-2 pt-5">
          <input
            id="cat-capital"
            type="checkbox"
            {...form.register('isCapital')}
            className="h-4 w-4"
          />
          <Label htmlFor="cat-capital">Capital improvement</Label>
        </div>
      </div>

      {fieldErrors.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground">
          <div className="font-medium mb-1">Fix these before saving:</div>
          <ul className="list-disc pl-5">
            {fieldErrors.map((e) => (
              <li key={e.field}>
                <span className="font-mono">{e.field}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

export default function CategoriesTab() {
  const { categories, load, create, update, remove } = useCategoriesStore();
  const { overrides, load: loadOverrides, remove: removeOverride } = useMerchantOverridesStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadOverrides();
  }, [load, loadOverrides]);

  // Stale-edit-target reset
  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!categories.some((c) => c.id === mode.id)) setMode('list');
    }
  }, [mode, categories]);

  // Top-level categories are valid parents
  const parentOptions = useMemo(
    () => categories.filter((c) => c.parentCategoryId === null),
    [categories],
  );

  // Assumes a two-level tree (parents + their direct children); the seed tree and the parent-picker enforce this — deeper nesting would not render.
  // Group categories: parents with children, then standalone
  const grouped = useMemo(() => {
    const parents = categories.filter((c) => c.parentCategoryId === null);
    const result: Category[] = [];
    for (const p of parents) {
      result.push(p);
      const children = categories.filter((c) => c.parentCategoryId === p.id);
      result.push(...children);
    }
    return result;
  }, [categories]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c])),
    [categories],
  );

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add category</h2>
        <CategoryForm
          initial={DEFAULT_VALUES}
          parents={parentOptions}
          onSubmit={async (v) => {
            await create({ ...v, systemManaged: false });
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = categories.find((c) => c.id === mode.id);
    if (!target) return null;
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit category</h2>
        <CategoryForm
          initial={{
            name: target.name,
            parentCategoryId: target.parentCategoryId,
            color: target.color,
            icon: target.icon,
            type: target.type,
            isCapital: target.isCapital,
            monthlyBudget: target.monthlyBudget,
          }}
          parents={parentOptions.filter((p) => p.id !== target.id)}
          onSubmit={async (v) => {
            await update(mode.id, v);
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      {/* Section 1 — Category tree */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-2xl font-semibold">Categories</h2>
            <p className="text-sm text-muted-foreground">
              Organize spending into a two-level tree. System categories are locked.
            </p>
          </div>
          <Button onClick={() => setMode('create')}>Add Category</Button>
        </div>

        {categories.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No categories yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1">
            {grouped.map((cat) => {
              const isChild = cat.parentCategoryId !== null;
              return (
                <Card key={cat.id} data-testid="categories-row">
                  <CardContent className="flex items-center justify-between gap-3 py-2 px-4">
                    <div className={`flex items-center gap-2 min-w-0 flex-1 ${isChild ? 'pl-6' : ''}`}>
                      {cat.icon && <span className="shrink-0">{cat.icon}</span>}
                      <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium truncate">{cat.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{cat.type}</span>
                        {cat.systemManaged && (
                          <span className="text-xs text-muted-foreground shrink-0" title="System managed">
                            🔒
                          </span>
                        )}
                      </div>
                    </div>
                    {!cat.systemManaged && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setMode({ type: 'edit', id: cat.id! })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Delete ${cat.name}?`,
                              description:
                                'This also deletes any learned merchant corrections that map to it, and leaves transactions in this category uncategorized. This can’t be undone.',
                            });
                            if (ok) await remove(cat.id!);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2 — Merchant overrides */}
      <div>
        <h2 className="text-2xl font-semibold mb-1">Merchant overrides</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Learned corrections from the review modal. Delete any mis-categorized entry.
        </p>
        {overrides.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No overrides yet. They appear here after you correct a category during PDF import.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1">
            {overrides.map((ov) => {
              const catName = categoryById.get(ov.categoryId)?.name ?? `#${ov.categoryId}`;
              return (
                <Card key={ov.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-2 px-4">
                    <div className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-sm">{ov.merchantPattern}</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="text-sm">{catName}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete this merchant override?',
                          description:
                            'This removes the learned correction. Future imports of this merchant won’t be auto-categorized by it. This can’t be undone.',
                        });
                        if (ok) await removeOverride(ov.id!);
                      }}
                      className="shrink-0"
                    >
                      Delete
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
