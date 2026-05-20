import { create } from 'zustand';
import { CategoriesRepo } from '@/domain/categories';
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

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new CategoriesRepo(getDatabase());
      const categories = await repo.list();
      set({ categories, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

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
