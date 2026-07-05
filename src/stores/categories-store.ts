import { create } from 'zustand';
import { CategoriesRepo } from '@/domain/categories';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { Category } from '@/types/schema';

interface CategoriesState {
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (cat: Omit<Category, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Category, 'id' | 'systemManaged'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<CategoriesState, 'categories'>(set, 'categories', async () =>
    new CategoriesRepo(getDatabase()).list(),
  ),

  create: async (cat) => {
    const repo = new CategoriesRepo(getDatabase());
    const id = await repo.create(cat);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new CategoriesRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new CategoriesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
