import { create } from 'zustand';
import { TaxRulesRepo } from '@/domain/tax-rules';
import { getDatabase } from '@/db/db';
import type { TaxRule, JurisdictionType, FilingStatus } from '@/types/schema';

interface TaxRulesState {
  year: number | null;
  items: TaxRule[];
  isLoading: boolean;
  error: string | null;
  loadYear: (year: number) => Promise<void>;
  lookup: (jurisdictionType: JurisdictionType, code: string, filingStatus: FilingStatus) => TaxRule | null;
}

export const useTaxRulesStore = create<TaxRulesState>((set, get) => ({
  year: null,
  items: [],
  isLoading: false,
  error: null,

  async loadYear(year: number) {
    if (get().year === year && get().items.length > 0) return;
    set({ isLoading: true, error: null });
    try {
      const repo = new TaxRulesRepo(getDatabase());
      const items = await repo.listForYear(year);
      set({ year, items, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false });
    }
  },

  lookup(jurisdictionType, code, filingStatus) {
    return (
      get().items.find(
        (r) =>
          r.jurisdictionType === jurisdictionType &&
          r.jurisdictionCode === code &&
          r.filingStatus === filingStatus,
      ) ?? null
    );
  },
}));
