/**
 * Shared jurisdiction-display helpers. Extracted 2026-05-28 from
 * HouseholdForm.tsx so the Paycheck Calculator and the Household form use one
 * copy of the state list + city-label logic.
 */

/**
 * Convert a jurisdiction code like NY_NYC -> "NYC", MI_DETROIT -> "Detroit".
 * Keeps short all-caps abbreviations (length <= 3 letters, all uppercase)
 * as-is to avoid mangling NYC, DC, etc.
 */
export function prettifyCityCode(code: string): string {
  const parts = code.split('_');
  // First part is the state prefix; drop it.
  const rest = parts.slice(1);
  return rest
    .map((p) => {
      if (p.length <= 3 && /^[A-Z]+$/.test(p)) return p;
      return p.charAt(0) + p.slice(1).toLowerCase();
    })
    .join(' ');
}

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];
