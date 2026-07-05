import { create } from 'zustand';
import { PersonsRepo } from '@/domain/persons';
import { createDedupedLoad } from '@/stores/create-entity-store';
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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<PersonsState, 'persons'>(set, 'persons', async () =>
    new PersonsRepo(getDatabase()).list(),
  ),

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
