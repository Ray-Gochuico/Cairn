import type { MerchantOverride, MerchantSeed } from '@/types/schema';

interface Mapping {
  merchantPattern: string;
  categoryId: number;
}

/**
 * Resolve a category id for a merchant. Per-household overrides win over the
 * shipped seed map; within each layer the **longest** matching pattern wins
 * (most specific). Matching is case-insensitive substring. Returns null when
 * nothing matches — the UI then shows the row as uncategorized.
 */
export function categorize(
  merchant: string,
  overrides: MerchantOverride[],
  seeds: MerchantSeed[],
): number | null {
  const hay = merchant.toUpperCase();
  const bestMatch = (maps: Mapping[]): number | null => {
    let bestLen = -1;
    let bestId: number | null = null;
    for (const m of maps) {
      const pat = m.merchantPattern.toUpperCase();
      if (pat.length > bestLen && hay.includes(pat)) {
        bestLen = pat.length;
        bestId = m.categoryId;
      }
    }
    return bestId;
  };
  return bestMatch(overrides) ?? bestMatch(seeds);
}
