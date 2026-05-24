// src/lib/import/resolver.ts

export type AccountResolution =
  | { ok: true; accountId: number }
  | { ok: false; reason: 'not_found' | 'ambiguous'; matches?: number[] };

export type PersonResolution =
  | { ok: true; personId: number | null }
  | { ok: false; reason: 'not_found' | 'ambiguous'; matches?: number[] };

interface NamedRow {
  id: number;
  name: string;
}

/**
 * Resolve an account reference from a CSV row.
 * - If `explicitId` is non-null, use it (or report not_found if the id doesn't exist).
 * - Else match `nameOrEmpty` against `accounts` by case-insensitive trimmed name.
 * - Empty name + no id → not_found.
 * - Multiple name matches → ambiguous (with all candidate ids).
 */
export function resolveAccount(
  nameOrEmpty: string,
  explicitId: number | null,
  accounts: ReadonlyArray<NamedRow>,
): AccountResolution {
  if (explicitId !== null) {
    return accounts.some((a) => a.id === explicitId)
      ? { ok: true, accountId: explicitId }
      : { ok: false, reason: 'not_found' };
  }
  const norm = nameOrEmpty.trim().toLowerCase();
  if (!norm) return { ok: false, reason: 'not_found' };
  const matches = accounts.filter((a) => a.name.trim().toLowerCase() === norm);
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) {
    return { ok: false, reason: 'ambiguous', matches: matches.map((a) => a.id) };
  }
  return { ok: true, accountId: matches[0].id };
}

/**
 * Resolve a person reference. Empty name → personId: null (joint convention).
 */
export function resolvePerson(
  nameOrEmpty: string,
  explicitId: number | null,
  persons: ReadonlyArray<NamedRow>,
): PersonResolution {
  if (explicitId !== null) {
    return persons.some((p) => p.id === explicitId)
      ? { ok: true, personId: explicitId }
      : { ok: false, reason: 'not_found' };
  }
  const norm = nameOrEmpty.trim().toLowerCase();
  if (!norm) return { ok: true, personId: null };
  const matches = persons.filter((p) => p.name.trim().toLowerCase() === norm);
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) {
    return { ok: false, reason: 'ambiguous', matches: matches.map((p) => p.id) };
  }
  return { ok: true, personId: matches[0].id };
}
