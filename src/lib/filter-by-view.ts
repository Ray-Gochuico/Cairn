import type { ViewFilter } from './use-view-filter';

/**
 * Pure filter helpers used by every visualization page to honour the
 * household / p1 / p2 / joint dropdown from `useViewFilter`. Each helper
 * keeps the page-level diff small: load the store data, run it through one
 * of these, pass the filtered list to your existing useMemo derivations.
 *
 * Conventions:
 *   - 'household' returns the input untouched (no person filtering).
 *   - 'joint' returns only rows whose person-id field is `null`, matching
 *     the schema convention for "joint / household-level" ownership.
 *   - 'p1'/'p2' resolve to `persons[0]?.id` / `persons[1]?.id`. If that
 *     person hasn't been persisted yet (`id == null`), the result is an
 *     empty array — there can't be any owned rows for a person with no id.
 *
 * Note: `EquityGrant.ownerPersonId` is non-nullable (grants are individual
 * per the Phase 3 schema). Pages handling grants must filter inline rather
 * than use these helpers — see EquityGrants.tsx.
 */

export function filterByOwnerPersonId<T extends { ownerPersonId: number | null }>(
  items: T[],
  filter: ViewFilter,
  persons: { id?: number }[],
): T[] {
  if (filter === 'household') return items;
  if (filter === 'joint') return items.filter((i) => i.ownerPersonId === null);
  const personId = filter === 'p1' ? persons[0]?.id : persons[1]?.id;
  if (personId == null) return [];
  return items.filter((i) => i.ownerPersonId === personId);
}

export function filterByObligorPersonId<T extends { obligorPersonId: number | null }>(
  items: T[],
  filter: ViewFilter,
  persons: { id?: number }[],
): T[] {
  if (filter === 'household') return items;
  if (filter === 'joint') return items.filter((i) => i.obligorPersonId === null);
  const personId = filter === 'p1' ? persons[0]?.id : persons[1]?.id;
  if (personId == null) return [];
  return items.filter((i) => i.obligorPersonId === personId);
}

export function filterByForPersonId<T extends { forPersonId: number | null }>(
  items: T[],
  filter: ViewFilter,
  persons: { id?: number }[],
): T[] {
  if (filter === 'household') return items;
  if (filter === 'joint') return items.filter((i) => i.forPersonId === null);
  const personId = filter === 'p1' ? persons[0]?.id : persons[1]?.id;
  if (personId == null) return [];
  return items.filter((i) => i.forPersonId === personId);
}

export function filterByPersonId<T extends { personId: number | null }>(
  items: T[],
  filter: ViewFilter,
  persons: { id?: number }[],
): T[] {
  if (filter === 'household') return items;
  if (filter === 'joint') return items.filter((i) => i.personId === null);
  const personId = filter === 'p1' ? persons[0]?.id : persons[1]?.id;
  if (personId == null) return [];
  return items.filter((i) => i.personId === personId);
}
