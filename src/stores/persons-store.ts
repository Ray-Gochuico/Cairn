import { create } from 'zustand';
import { PersonsRepo } from '@/domain/persons';
import { getDatabase } from '@/db/db';
import type { Person } from '@/types/schema';

interface PersonsState {
  persons: Person[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (person: Omit<Person, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Person, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const usePersonsStore = create<PersonsState>((set, get) => ({
  persons: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new PersonsRepo(getDatabase());
      const persons = await repo.list();
      set({ persons, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (person) => {
    const repo = new PersonsRepo(getDatabase());
    const id = await repo.create(person);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new PersonsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new PersonsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
