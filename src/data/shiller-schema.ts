import { z } from 'zod';
import { SHILLER_ANNUAL, type ShillerAnnualRow } from './shiller';

const finite = z.number().refine((n) => Number.isFinite(n), 'must be finite');

export const ShillerAnnualRowSchema = z.object({
  year: z.number().int().min(1871),
  sp500NominalReturn: finite,
  sp500RealReturn: finite,
  tenYearTreasuryReturn: finite,
  cpi: z.number().positive(),
});

export type ShillerAnnualRowParsed = z.infer<typeof ShillerAnnualRowSchema>;

let cache: ShillerAnnualRow[] | null = null;

/**
 * Returns the validated Shiller annual series. Parses once (memoized) so a
 * malformed transcription fails loudly in tests/dev rather than silently
 * producing wrong success rates downstream. Sorted ascending by year.
 */
export function loadShillerAnnual(): ShillerAnnualRow[] {
  if (cache) return cache;
  const parsed = z.array(ShillerAnnualRowSchema).parse(SHILLER_ANNUAL);
  cache = [...parsed].sort((a, b) => a.year - b.year);
  return cache;
}
