import { create } from 'zustand';
import { PersonsRepo } from '@/domain/persons';
import { getDatabase } from '@/db/db';
import type { Person } from '@/types/schema';

/**
 * The chart-answer columns added by the roadmap rule-engine migration
 * are managed by roadmap decision nodes, not by the person CRUD UI, so
 * the create form doesn't supply them. Accept a narrower shape at the
 * store boundary and fill the missing fields with null defaults before
 * handing off to the repo.
 */
type PersonCreateInput = Omit<
  Person,
  | 'id'
  | 'jobStability'
  | 'expectsHigherFutureIncome'
  | 'onParentHealthInsurance'
  | 'isRelativelyHealthy'
>;

interface PersonsState {
  persons: Person[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (person: PersonCreateInput) => Promise<number>;
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
    // Fill chart-answer defaults before handing off; the repo's INSERT
    // doesn't write these columns yet, so the DB defaults to NULL.
    const id = await repo.create({
      ...person,
      jobStability: null,
      expectsHigherFutureIncome: null,
      onParentHealthInsurance: null,
      isRelativelyHealthy: null,
    });
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
