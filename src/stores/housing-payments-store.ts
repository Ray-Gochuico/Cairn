import { create } from 'zustand';
import { HousingPaymentsRepo } from '@/domain/housing-payments';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { HousingPayment } from '@/types/schema';

interface HousingPaymentsState {
  housingPayments: HousingPayment[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (payment: Omit<HousingPayment, 'id'>) => Promise<number>;
  update: (
    id: number,
    patch: Partial<Omit<HousingPayment, 'id' | 'householdId'>>,
  ) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useHousingPaymentsStore = create<HousingPaymentsState>((set, get) => ({
  housingPayments: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<HousingPaymentsState, 'housingPayments'>(set, 'housingPayments', async () =>
    new HousingPaymentsRepo(getDatabase()).list(),
  ),

  create: async (payment) => {
    const repo = new HousingPaymentsRepo(getDatabase());
    const id = await repo.create(payment);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new HousingPaymentsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new HousingPaymentsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
