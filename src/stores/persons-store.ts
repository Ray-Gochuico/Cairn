import { create } from 'zustand';
import { PersonsRepo } from '@/domain/persons';
import { getDatabase } from '@/db/db';
import type { Person } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch.
 *
 * Known, accepted TOCTOU (do NOT "fix" without re-reading this): a CRUD
 * mutation's `await get().load()` that fires while an *initial* load() is still
 * in flight piggybacks the pre-mutation in-flight promise and could briefly
 * show stale data. This is unreproducible on the synchronous better-sqlite3
 * test adapter (the piggybacked SELECT runs after the write commits), so it has
 * no honest regression test; the only window is the sub-second, pre-interactive
 * initial-mount race on the async Tauri adapter. Accepted as negligible by the
 * Track-3 final review (2026-06-01). A bypass (clear *Inflight before the
 * post-write load, or add a private forceReload()) was scoped and declined:
 * 6 stores of churn in hot code for a defect with no testable failure.
 */
let personsInflight: Promise<void> | null = null;

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
    if (personsInflight) return personsInflight;
    personsInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new PersonsRepo(getDatabase());
        const persons = await repo.list();
        set({ persons, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        personsInflight = null;
      }
    })();
    return personsInflight;
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
