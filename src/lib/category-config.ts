import type { Category } from '@/types/schema';

export type UtilityBucketKey = 'property_utilities' | 'vehicle_gas';

interface SeedLookup {
  childName: string;
  parentName: string;
}

const SEED_LOOKUPS: Record<UtilityBucketKey, SeedLookup> = {
  property_utilities: { childName: 'Utilities', parentName: 'Home' },
  vehicle_gas: { childName: 'Gas/Fuel', parentName: 'Vehicles' },
};

function seededIdFor(categories: Category[], lookup: SeedLookup): number | null {
  const parent = categories.find(
    (c) => c.name === lookup.parentName && c.parentCategoryId === null,
  );
  if (!parent) return null;
  const child = categories.find(
    (c) => c.name === lookup.childName && c.parentCategoryId === parent.id,
  );
  return child?.id ?? null;
}

/**
 * Resolve the effective category IDs for one stat bucket on the Property
 * or Vehicle page.
 *
 * Precedence:
 *   1. configured == null → fall back to the seeded default (child + parent
 *      name lookup). Returns [seededId] if found, else [].
 *   2. configured == [] → user explicitly disabled this bucket. Returns [].
 *   3. configured == [a, b, c] → filter to ids that exist in `categories`.
 *      If at least one survives, return only the survivors (no fallback).
 *      If filtering empties the array (all stale), fall back to the seeded
 *      default — treat "all my picks were deleted" as equivalent to
 *      "I haven't configured yet".
 */
export function resolveUtilityCategoryIds(
  configured: number[] | null,
  categories: Category[],
  bucketKey: UtilityBucketKey,
): number[] {
  const seededId = seededIdFor(categories, SEED_LOOKUPS[bucketKey]);
  const fallback = seededId == null ? [] : [seededId];

  if (configured === null) return fallback;
  if (configured.length === 0) return [];

  const validIds = new Set(
    categories
      .map((c) => c.id)
      .filter((id): id is number => id != null),
  );
  const filtered = configured.filter((id) => validIds.has(id));
  if (filtered.length === 0) return fallback;
  return filtered;
}
