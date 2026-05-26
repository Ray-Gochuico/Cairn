import { describe, it, expect } from 'vitest';
import { resolveUtilityCategoryIds } from '@/lib/category-config';
import type { Category } from '@/types/schema';
import { CategoryType } from '@/types/enums';

// Seed mirrors 0009_seed_categories.sql:
//   1   Home              (parent: null)
//   10  Utilities         (parent: 1)
//   2   Vehicles          (parent: null)
//   17  Gas/Fuel          (parent: 2)
const baseCat = (overrides: Partial<Category>): Category => ({
  id: 0,
  name: '',
  parentCategoryId: null,
  color: null,
  icon: null,
  type: CategoryType.NEED,
  isCapital: false,
  systemManaged: false,
  monthlyBudget: null,
  ...overrides,
});

const SEED: Category[] = [
  baseCat({ id: 1, name: 'Home' }),
  baseCat({ id: 10, name: 'Utilities', parentCategoryId: 1 }),
  baseCat({ id: 2, name: 'Vehicles' }),
  baseCat({ id: 17, name: 'Gas/Fuel', parentCategoryId: 2 }),
];

describe('resolveUtilityCategoryIds', () => {
  describe('property_utilities bucket', () => {
    it('configured=null + seeded "Home > Utilities" present → returns [seededId]', () => {
      expect(resolveUtilityCategoryIds(null, SEED, 'property_utilities')).toEqual([10]);
    });

    it('configured=null + seeded missing → returns []', () => {
      const noUtilities = SEED.filter((c) => c.id !== 10);
      expect(resolveUtilityCategoryIds(null, noUtilities, 'property_utilities')).toEqual([]);
    });

    it('configured=[] → returns [] (explicit empty)', () => {
      expect(resolveUtilityCategoryIds([], SEED, 'property_utilities')).toEqual([]);
    });

    it('configured=[10,20] with 20 stale → returns [10] (partial filter, no fallback)', () => {
      expect(resolveUtilityCategoryIds([10, 20], SEED, 'property_utilities')).toEqual([10]);
    });

    it('configured=[99] all stale → falls back to seeded [10]', () => {
      expect(resolveUtilityCategoryIds([99], SEED, 'property_utilities')).toEqual([10]);
    });

    it('configured=[10] = seeded match → returns [10]', () => {
      expect(resolveUtilityCategoryIds([10], SEED, 'property_utilities')).toEqual([10]);
    });

    it('configured=[10, 11, 12] all valid → returns all three', () => {
      const withMore = [
        ...SEED,
        baseCat({ id: 11, name: 'Internet', parentCategoryId: 1 }),
        baseCat({ id: 12, name: 'Streaming', parentCategoryId: 1 }),
      ];
      expect(resolveUtilityCategoryIds([10, 11, 12], withMore, 'property_utilities')).toEqual([
        10, 11, 12,
      ]);
    });
  });

  describe('vehicle_gas bucket', () => {
    it('configured=null + seeded "Vehicles > Gas/Fuel" present → returns [seededId]', () => {
      expect(resolveUtilityCategoryIds(null, SEED, 'vehicle_gas')).toEqual([17]);
    });

    it('configured=null + seeded missing → returns []', () => {
      const noGas = SEED.filter((c) => c.id !== 17);
      expect(resolveUtilityCategoryIds(null, noGas, 'vehicle_gas')).toEqual([]);
    });

    it('configured=[] → returns []', () => {
      expect(resolveUtilityCategoryIds([], SEED, 'vehicle_gas')).toEqual([]);
    });

    it('configured=[99] all stale → falls back to seeded [17]', () => {
      expect(resolveUtilityCategoryIds([99], SEED, 'vehicle_gas')).toEqual([17]);
    });

    it('configured=[17,18,19] with 18 and 19 stale → returns [17]', () => {
      expect(resolveUtilityCategoryIds([17, 18, 19], SEED, 'vehicle_gas')).toEqual([17]);
    });
  });
});
