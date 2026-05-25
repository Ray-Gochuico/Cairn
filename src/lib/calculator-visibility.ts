const KEY = 'calculator-hidden-cards';

// One-time migration map for renamed card ids. Older persisted values may
// still reference the legacy id; we translate on read so the user keeps their
// hidden-state across the rename.
const LEGACY_ID_MIGRATIONS: Record<string, string> = {
  fire: 'financial-independence',
};

function migrateId(id: string): string {
  return LEGACY_ID_MIGRATIONS[id] ?? id;
}

export function getHiddenCards(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((x): x is string => typeof x === 'string').map(migrateId);
    // De-dupe in case both the legacy and renamed id were somehow present.
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export function persistHiddenCards(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable (private mode / quota / SSR); the React
    // state still updates so the UI behaves correctly within the session.
  }
}

export function hideCard(id: string): void {
  const current = getHiddenCards();
  if (!current.includes(id)) {
    persistHiddenCards([...current, id]);
  }
}

export function showCard(id: string): void {
  const current = getHiddenCards();
  persistHiddenCards(current.filter((x) => x !== id));
}

export function isHidden(id: string, autoVisibilityResult: boolean): boolean {
  if (!autoVisibilityResult) return true;
  return getHiddenCards().includes(id);
}
